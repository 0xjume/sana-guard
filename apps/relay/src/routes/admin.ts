import { Hono } from "hono";
import { z } from "zod";
import type { NearClient, VaultInfo } from "../near/interface.js";
import type { RelayDatabase } from "../db.js";
import type { Config } from "../config.js";
import {
  parseAdminMessage,
  verifySignature,
  extractOwner,
  getVaultId,
  type ParsedAdminMessage,
} from "../validation.js";
import {
  calculateRequiredDeposit,
  calculateGas,
  estimateGasCostYocto,
  wouldBreachFloor,
} from "../budget.js";
import { yoctoToNearString } from "../constants.js";
import { createRequestLogger } from "../logger.js";
import { createAdminRateLimit } from "../middleware/rateLimit.js";
import { bodyLimit } from "../middleware/bodyLimit.js";
import { tokensEqual } from "../crypto.js";
import {
  isOnChainExecutionError,
  isPreAcceptanceRejection,
  isPreSignError,
  txHashFromUnknown,
} from "../near/errors.js";
import { spentAfterOutcome } from "../resolve.js";

const adminRequestSchema = z.object({
  msg: z.string(),
  signature: z.array(z.number()).length(64),
  owner: z.string().optional(),
});

export function checkInviteGate(
  actionType: string,
  owner: string,
  inviteHeader: string | undefined,
  config: Config
): { allowed: boolean; reason?: string } {
  if (actionType !== "CreateVault" && actionType !== "AddAgent") {
    return { allowed: true };
  }

  if (!config.adminGateEnabled) {
    return { allowed: true };
  }

  const token = config.inviteToken?.trim();
  const allowlist = config.ownerAllowlist
    ?.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (!token && (!allowlist || allowlist.length === 0)) {
    return {
      allowed: false,
      reason:
        "CreateVault/AddAgent are gated. Set INVITE_TOKEN and/or OWNER_ALLOWLIST, or ADMIN_GATE_ENABLED=false for private use.",
    };
  }

  if (token && !tokensEqual(inviteHeader ?? "", token)) {
    return { allowed: false, reason: "Invalid or missing invite token" };
  }

  if (allowlist && allowlist.length > 0 && !allowlist.includes(owner)) {
    return { allowed: false, reason: "Owner not in allowlist" };
  }

  return { allowed: true };
}

function parseOnChainError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    const sgMatch = error.message.match(/SG_E\d+_[A-Z_]+/);
    if (sgMatch) return sgMatch[0]!;
  }
  return "Transaction failed";
}

type ReserveOutcome =
  | { kind: "ok" }
  | { kind: "conflict" }
  | { kind: "reserve-fail"; reason: string }
  | {
      kind: "bad";
      status: 400 | 401 | 404 | 503;
      error: string;
      extra?: Record<string, unknown>;
    };

function nonceConflictBody(): { error: string; code: "NONCE_IN_FLIGHT" } {
  return {
    error: "Request with same nonce already in progress",
    code: "NONCE_IN_FLIGHT",
  };
}

function reserveFailCode(
  reason: string
): "NONCE_IN_FLIGHT" | "LIMIT_EXCEEDED" | "BUDGET_EXCEEDED" {
  if (reason.includes("nonce")) return "NONCE_IN_FLIGHT";
  if (reason.toLowerCase().includes("limit")) return "LIMIT_EXCEEDED";
  return "BUDGET_EXCEEDED";
}

async function reserveAdminRequest(args: {
  db: RelayDatabase;
  nearClient: NearClient;
  config: Config;
  owner: string;
  parsedMsg: ParsedAdminMessage;
  vault: VaultInfo | null;
  onChainNonce: number;
  depositYocto: string;
  gasCostYocto: string;
  floorYocto: bigint;
  nowMs: number;
}): Promise<ReserveOutcome> {
  const {
    db,
    nearClient,
    config,
    owner,
    parsedMsg,
    vault,
    onChainNonce,
    depositYocto,
    gasCostYocto,
    floorYocto,
    nowMs,
  } = args;

  // Global lock wraps cheap re-validation + one view_account + the reserve.
  return db.withGlobalLock(async () =>
    db.withOwnerLock(owner, async () => {
      if (db.checkNonceInFlight(owner, parsedMsg.nonce)) {
        return { kind: "conflict" };
      }

      if (parsedMsg.action.type !== "CreateVault") {
        if (!vault) {
          return { kind: "bad", status: 404, error: "Vault not found" };
        }
        if (vault.owner !== owner) {
          return { kind: "bad", status: 401, error: "Owner does not match vault" };
        }
      }

      if (parsedMsg.nonce <= onChainNonce) {
        return {
          kind: "bad",
          status: 400,
          error: "Nonce too old",
          extra: { provided: parsedMsg.nonce, onChainNonce },
        };
      }

      const relayBalance = await nearClient.getBalance();
      const available = (
        BigInt(relayBalance) - BigInt(db.getOutstandingReservedYocto())
      ).toString();
      if (wouldBreachFloor(available, depositYocto, gasCostYocto, floorYocto)) {
        return {
          kind: "bad",
          status: 503,
          error:
            "Service temporarily unavailable: transaction would breach balance floor",
          extra: { code: "BALANCE_TOO_LOW" },
        };
      }

      const expiresAtMs = Number(parsedMsg.expiry / 1_000_000n);
      const result = db.tryReserveBudget({
        owner,
        nonce: parsedMsg.nonce,
        action: parsedMsg.action,
        depositYocto,
        gasCostYocto,
        nowMs,
        expiresAtMs,
        config,
      });
      if (!result.ok) {
        return { kind: "reserve-fail", reason: result.reason };
      }
      return { kind: "ok" };
    })
  );
}

export function createAdminRouter(
  nearClient: NearClient,
  db: RelayDatabase,
  config: Config
) {
  const app = new Hono();

  app.post(
    "/v1/admin",
    bodyLimit,
    createAdminRateLimit(config),
    async (c) => {
    const log = createRequestLogger();
    const nowMs = Date.now();

    try {
      const body = await c.req.json();
      const parsed = adminRequestSchema.parse(body);
      const msg = parsed.msg;
      const signature = new Uint8Array(parsed.signature);

      log.info("Received admin request");

      let parsedMsg;
      try {
        parsedMsg = parseAdminMessage(msg);
      } catch (error: unknown) {
        log.warn({ error }, "Message parsing failed");
        return c.json(
          {
            error:
              error instanceof Error ? error.message : "Invalid message format",
          },
          400
        );
      }

      if (parsedMsg.network !== `near-${config.nearNetwork}`) {
        log.warn(
          { expected: `near-${config.nearNetwork}`, got: parsedMsg.network },
          "Network mismatch"
        );
        return c.json(
          {
            error: "Invalid network",
            expected: `near-${config.nearNetwork}`,
            got: parsedMsg.network,
          },
          400
        );
      }

      if (parsedMsg.contract !== config.guardContractId) {
        log.warn(
          { expected: config.guardContractId, got: parsedMsg.contract },
          "Contract mismatch"
        );
        return c.json(
          {
            error: "Invalid contract",
            expected: config.guardContractId,
            got: parsedMsg.contract,
          },
          400
        );
      }

      const nowNs = BigInt(Date.now()) * 1_000_000n;
      if (parsedMsg.expiry <= nowNs) {
        log.warn({ expiry: parsedMsg.expiry.toString() }, "Message expired");
        return c.json({ error: "Message expired" }, 400);
      }

      const vaultIdFromAction = getVaultId(parsedMsg.action);
      if (parsedMsg.action.type === "CreateVault") {
        if (parsedMsg.vault !== null) {
          return c.json(
            { error: "Vault header must be null for CreateVault" },
            400
          );
        }
      } else if (parsedMsg.vault !== vaultIdFromAction) {
        log.warn(
          { header: parsedMsg.vault, action: vaultIdFromAction },
          "Vault header mismatch"
        );
        return c.json(
          {
            error: "Vault header mismatch",
            expected: vaultIdFromAction,
            got: parsedMsg.vault,
          },
          400
        );
      }

      let owner: string;
      if (parsedMsg.action.type === "CreateVault") {
        owner = extractOwner(parsedMsg.action);
        if (parsed.owner && parsed.owner !== owner) {
          return c.json({ error: "Owner field does not match action" }, 400);
        }
      } else if (parsed.owner) {
        owner = parsed.owner;
      } else {
        return c.json(
          { error: "owner is required for this action so the signature can be verified before any RPC call" },
          400
        );
      }

      if (!verifySignature(msg, signature, owner)) {
        log.warn({ owner }, "Invalid signature");
        return c.json({ error: "Invalid signature" }, 401);
      }

      const inviteCheck = checkInviteGate(
        parsedMsg.action.type,
        owner,
        c.req.header("x-invite-token"),
        config
      );
      if (!inviteCheck.allowed) {
        log.warn({ reason: inviteCheck.reason }, "Invite gate failed");
        return c.json({ error: inviteCheck.reason, code: "ACCESS_DENIED" }, 403);
      }

      let depositYocto: string;
      try {
        depositYocto = calculateRequiredDeposit(parsedMsg.action, config);
      } catch (error: unknown) {
        log.warn({ error }, "Deposit calculation failed");
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Invalid action parameters",
          },
          400
        );
      }

      const gasAmount = calculateGas(parsedMsg.action);
      const gasCostYocto = estimateGasCostYocto(parsedMsg.action);
      const floorYocto = config.relayBalanceFloorYocto;

      if (db.checkNonceInFlight(owner, parsedMsg.nonce)) {
        log.warn({ owner, nonce: parsedMsg.nonce }, "Nonce already in flight");
        return c.json(nonceConflictBody(), 409);
      }

      // Slow RPC views happen before the global lock.
      let vault: VaultInfo | null = null;
      if (parsedMsg.action.type !== "CreateVault") {
        if (vaultIdFromAction === null) {
          return c.json({ error: "Vault ID is required" }, 400);
        }
        vault = await nearClient.getVault(vaultIdFromAction);
        if (!vault) {
          return c.json({ error: "Vault not found" }, 404);
        }
        if (vault.owner !== owner) {
          return c.json({ error: "Owner does not match vault" }, 401);
        }
      }
      const onChainNonce = await nearClient.getOwnerNonce(owner);
      if (parsedMsg.nonce <= onChainNonce) {
        return c.json(
          { error: "Nonce too old", provided: parsedMsg.nonce, onChainNonce },
          400
        );
      }

      const reserved = await reserveAdminRequest({
        db,
        nearClient,
        config,
        owner,
        parsedMsg,
        vault,
        onChainNonce,
        depositYocto,
        gasCostYocto,
        floorYocto,
        nowMs,
      });

      if (reserved.kind === "conflict") {
        return c.json(nonceConflictBody(), 409);
      }
      if (reserved.kind === "bad") {
        return c.json(
          { error: reserved.error, ...reserved.extra },
          reserved.status
        );
      }
      if (reserved.kind === "reserve-fail") {
        const code = reserveFailCode(reserved.reason);
        return c.json(
          { error: reserved.reason, code },
          code === "NONCE_IN_FLIGHT" ? 409 : 429
        );
      }

      log.info(
        { depositYocto, owner, nonce: parsedMsg.nonce, gas: gasAmount },
        "Submitting to NEAR"
      );

      return await db.withOwnerLock(owner, async () => {
        try {
          const result = await nearClient.submitOwnerAction(
            msg,
            parsed.signature,
            depositYocto,
            gasAmount,
            {
              onSigned: (txHash) => db.attachTxHash(owner, parsedMsg.nonce, txHash),
            }
          );

          const actualSpent = spentAfterOutcome({
            depositYocto,
            tokensBurntYocto: result.tokensBurntYocto,
            success: result.success,
          });

          db.reconcileBudget(
            owner,
            parsedMsg.nonce,
            actualSpent,
            result.txHash,
            result.success,
            nowMs
          );

          if (!result.success) {
            log.warn(
              { txHash: result.txHash, error: result.errorMessage },
              "Transaction failed"
            );
            return c.json(
              {
                success: false,
                txHash: result.txHash,
                error: parseOnChainError({ message: result.errorMessage }),
              },
              400
            );
          }

          log.info({ txHash: result.txHash }, "Transaction succeeded");
          return c.json({
            success: true,
            txHash: result.txHash,
            depositYocto,
            depositNear: yoctoToNearString(depositYocto),
          });
        } catch (error: unknown) {
          log.error({ error }, "Submission failed");
          if (isPreSignError(error)) {
            db.releaseBudget(owner, parsedMsg.nonce, nowMs);
            return c.json(
              { error: "Transaction could not be signed", code: "PRE_SIGN_FAILED" },
              503
            );
          }
          if (isPreAcceptanceRejection(error)) {
            db.releaseBudget(owner, parsedMsg.nonce, nowMs);
            return c.json(
              { error: "Transaction rejected before acceptance", code: "TX_REJECTED" },
              400
            );
          }
          const broadcastHash = txHashFromUnknown(error);
          if (broadcastHash && isOnChainExecutionError(error)) {
            db.finalizeBudget(owner, parsedMsg.nonce, broadcastHash, false);
            return c.json(
              {
                success: false,
                txHash: broadcastHash,
                error: parseOnChainError(error),
              },
              400
            );
          }
          db.markUnknown(owner, parsedMsg.nonce, broadcastHash);
          return c.json(
            { error: "Transaction status unknown; reservation held" },
            503
          );
        }
      });
    } catch (error: unknown) {
      log.error({ error }, "Request processing failed");
      if (error instanceof z.ZodError) {
        return c.json({ error: "Invalid request" }, 400);
      }
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return app;
}
