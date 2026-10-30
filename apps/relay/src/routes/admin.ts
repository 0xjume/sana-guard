import { Hono } from "hono";
import { z } from "zod";
import { randomBytes } from "crypto";
import type { NearClient } from "../near/interface.js";
import type { RelayDatabase } from "../db.js";
import type { Config } from "../config.js";
import {
  parseAdminMessage,
  verifySignature,
  extractOwner,
  getVaultId,
} from "../validation.js";
import {
  calculateRequiredDeposit,
  calculateGas,
  checkBudgets,
  checkActionLimits,
  estimateGasCostYocto,
  wouldBreachFloor,
} from "../budget.js";
import { parseNearToYocto, yoctoToNearString } from "../constants.js";
import { createRequestLogger } from "../logger.js";
import { adminRateLimit } from "../middleware/rateLimit.js";
import { bodyLimit } from "../middleware/bodyLimit.js";

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

  if (token && inviteHeader !== token) {
    return { allowed: false, reason: "Invalid or missing invite token" };
  }

  if (allowlist && allowlist.length > 0 && !allowlist.includes(owner)) {
    return { allowed: false, reason: "Owner not in allowlist" };
  }

  return { allowed: true };
}

function txHashFromUnknown(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "transaction" in error &&
    error.transaction &&
    typeof error.transaction === "object" &&
    "hash" in error.transaction
  ) {
    const hash = (error.transaction as { hash: unknown }).hash;
    return typeof hash === "string" ? hash : undefined;
  }
  return undefined;
}

function parseOnChainError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    const sgMatch = error.message.match(/SG_E\d+_[A-Z_]+/);
    if (sgMatch) return sgMatch[0]!;
    return error.message;
  }
  return "Transaction failed";
}

export function createAdminRouter(
  nearClient: NearClient,
  db: RelayDatabase,
  config: Config
) {
  const app = new Hono();

  app.post("/v1/admin", bodyLimit, adminRateLimit, async (c) => {
    const requestId = randomBytes(16).toString("hex");
    const log = createRequestLogger(requestId);
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
        depositYocto = calculateRequiredDeposit(parsedMsg.action);
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
      const floorYocto = parseNearToYocto(String(config.relayBalanceFloorNear));

      if (db.checkNonceInFlight(owner, parsedMsg.nonce)) {
        log.warn({ owner, nonce: parsedMsg.nonce }, "Nonce already in flight");
        return c.json(
          {
            error: "Request with same nonce already in progress",
            code: "NONCE_IN_FLIGHT",
          },
          409
        );
      }

      return await db.withOwnerLock(owner, async () => {
        if (db.checkNonceInFlight(owner, parsedMsg.nonce)) {
          log.warn({ owner, nonce: parsedMsg.nonce }, "Nonce already in flight");
          return c.json(
            {
              error: "Request with same nonce already in progress",
              code: "NONCE_IN_FLIGHT",
            },
            409
          );
        }

        if (parsedMsg.action.type !== "CreateVault") {
          const vaultId = vaultIdFromAction;
          if (vaultId === null) {
            return c.json({ error: "Vault ID is required" }, 400);
          }
          const vault = await nearClient.getVault(vaultId);
          if (!vault) {
            log.warn({ vaultId }, "Vault not found");
            return c.json({ error: "Vault not found" }, 404);
          }
          if (vault.owner !== owner) {
            return c.json({ error: "Owner does not match vault" }, 401);
          }
        }

        const onChainNonce = await nearClient.getOwnerNonce(owner);
        if (parsedMsg.nonce <= onChainNonce) {
          log.warn(
            { provided: parsedMsg.nonce, onChain: onChainNonce },
            "Nonce too old"
          );
          return c.json(
            {
              error: "Nonce too old",
              provided: parsedMsg.nonce,
              onChainNonce,
            },
            400
          );
        }

        const actionCheck = checkActionLimits(parsedMsg.action, db, nowMs);
        if (!actionCheck.allowed) {
          log.warn({ reason: actionCheck.reason }, "Action limit check failed");
          return c.json(
            { error: actionCheck.reason, code: "LIMIT_EXCEEDED" },
            429
          );
        }

        const budgetCheck = checkBudgets(
          owner,
          depositYocto,
          gasCostYocto,
          db,
          config,
          nowMs
        );
        if (!budgetCheck.allowed) {
          log.warn({ reason: budgetCheck.reason }, "Budget check failed");
          return c.json(
            { error: budgetCheck.reason, code: "BUDGET_EXCEEDED" },
            429
          );
        }

        const relayBalance = await nearClient.getBalance();
        if (
          wouldBreachFloor(relayBalance, depositYocto, gasCostYocto, floorYocto)
        ) {
          log.warn(
            {
              relayBalance,
              depositYocto,
              gasCostYocto,
              floor: floorYocto.toString(),
            },
            "Transaction would breach balance floor"
          );
          return c.json(
            {
              error:
                "Service temporarily unavailable: transaction would breach balance floor",
              code: "BALANCE_TOO_LOW",
            },
            503
          );
        }

        const totalSpent = (BigInt(depositYocto) + BigInt(gasCostYocto)).toString();
        db.reserveBudget(
          owner,
          parsedMsg.nonce,
          parsedMsg.action.type,
          totalSpent,
          nowMs
        );

        log.info(
          { depositYocto, owner, nonce: parsedMsg.nonce, gas: gasAmount },
          "Submitting to NEAR"
        );

        try {
          const result = await nearClient.submitOwnerAction(
            msg,
            parsed.signature,
            depositYocto,
            gasAmount
          );

          db.finalizeBudget(owner, parsedMsg.nonce, result.txHash, result.success);

          if (!result.success) {
            log.warn(
              { txHash: result.txHash, error: result.errorMessage },
              "Transaction failed"
            );
            return c.json(
              {
                success: false,
                txHash: result.txHash,
                error: result.errorMessage,
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
          const broadcastHash = txHashFromUnknown(error);
          if (broadcastHash) {
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
          db.releaseBudget(owner, parsedMsg.nonce, nowMs);
          return c.json(
            {
              error:
                error instanceof Error ? error.message : "Internal server error",
            },
            500
          );
        }
      });
    } catch (error: unknown) {
      log.error({ error }, "Request processing failed");
      if (error instanceof z.ZodError) {
        return c.json({ error: "Invalid request", details: error.errors }, 400);
      }
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Internal server error",
        },
        500
      );
    }
  });

  return app;
}
