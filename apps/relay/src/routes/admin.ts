import { Hono } from "hono";
import { z } from "zod";
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
  yoctoToNear,
} from "../budget.js";
import { ESTIMATED_GAS_COST } from "../constants.js";
import { createRequestLogger } from "../logger.js";
import { randomBytes } from "crypto";
import { adminRateLimit } from "../middleware/rateLimit.js";
import { bodyLimit } from "../middleware/bodyLimit.js";

const adminRequestSchema = z.object({
  msg: z.string(),
  signature: z.array(z.number()).length(64),
});

function checkInviteGate(
  actionType: string,
  owner: string,
  inviteHeader: string | undefined,
  config: Config
): { allowed: boolean; reason?: string } {
  if (actionType !== "CreateVault" && actionType !== "AddAgent") {
    return { allowed: true };
  }

  if (config.inviteToken && inviteHeader !== config.inviteToken) {
    return { allowed: false, reason: "Invalid or missing invite token" };
  }

  if (config.ownerAllowlist) {
    const allowed = config.ownerAllowlist.split(",").map((o) => o.trim());
    if (!allowed.includes(owner)) {
      return { allowed: false, reason: "Owner not in allowlist" };
    }
  }

  return { allowed: true };
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
          { expected: config.nearNetwork, got: parsedMsg.network },
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
      if (vaultIdFromAction !== null && parsedMsg.vault !== vaultIdFromAction) {
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
      } else {
        const vaultId = vaultIdFromAction;
        if (vaultId === null) {
          return c.json({ error: "Vault ID is required" }, 400);
        }
        const vault = await nearClient.getVault(vaultId);
        if (!vault) {
          log.warn({ vaultId }, "Vault not found");
          return c.json({ error: "Vault not found" }, 404);
        }
        owner = vault.owner;
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

      const relayBalance = await nearClient.getBalance();
      const relayBalanceNear = yoctoToNear(relayBalance);
      if (relayBalanceNear < config.relayBalanceFloorNear) {
        log.warn(
          { relayBalanceNear, floor: config.relayBalanceFloorNear },
          "Relay balance below floor"
        );
        return c.json(
          {
            error: "Service temporarily unavailable: insufficient relay balance",
            code: "BALANCE_TOO_LOW",
          },
          503
        );
      }

      let depositYocto: string;
      try {
        depositYocto = calculateRequiredDeposit(parsedMsg.action);
      } catch (error: unknown) {
        log.warn({ error }, "Deposit calculation failed");
        return c.json(
          {
            error:
              error instanceof Error ? error.message : "Invalid action parameters",
          },
          400
        );
      }

      const gasAmount = calculateGas(parsedMsg.action);
      const gasCostYocto = ESTIMATED_GAS_COST.toString();

      const totalCost = BigInt(depositYocto) + BigInt(gasCostYocto);
      const remainingBalance = BigInt(relayBalance) - totalCost;
      const floorYocto = BigInt(Math.floor(config.relayBalanceFloorNear * 1e24));

      if (remainingBalance < floorYocto) {
        log.warn(
          {
            relayBalance: relayBalance.toString(),
            totalCost: totalCost.toString(),
            remaining: remainingBalance.toString(),
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

        const totalSpent = (BigInt(depositYocto) + BigInt(gasCostYocto)).toString();
        db.reserveBudget(
          owner,
          parsedMsg.nonce,
          parsedMsg.action.type,
          totalSpent,
          nowMs
        );

        log.info({ depositYocto, owner, nonce: parsedMsg.nonce, gas: gasAmount }, "Submitting to NEAR");

        let result;
        try {
          result = await nearClient.submitOwnerAction(
            msg,
            parsed.signature,
            depositYocto,
            gasAmount
          );

          db.finalizeBudget(owner, parsedMsg.nonce, result.txHash, result.success);
        } catch (error: unknown) {
          log.error({ error }, "Submission failed before or after broadcast");
          db.releaseBudget(owner, parsedMsg.nonce, nowMs);

          if (
            error &&
            typeof error === "object" &&
            "transaction" in error &&
            error.transaction &&
            typeof error.transaction === "object" &&
            "hash" in error.transaction
          ) {
            const tx = error.transaction as { hash: unknown };
            const txHash =
              typeof tx.hash === "string"
                ? tx.hash
                : "unknown";
            
            let errorMsg = "Transaction failed";
            if ("message" in error && typeof error.message === "string") {
              const sgMatch = error.message.match(/SG_E\d+_[A-Z_]+/);
              errorMsg = sgMatch ? sgMatch[0]! : error.message;
            }

            return c.json(
              {
                success: false,
                txHash,
                error: errorMsg,
              },
              400
            );
          }

          return c.json(
            {
              error:
                error instanceof Error ? error.message : "Internal server error",
            },
            500
          );
        }

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
          depositNear: yoctoToNear(depositYocto),
        });
      });
    } catch (error: unknown) {
      log.error({ error }, "Request processing failed");
      if (error instanceof z.ZodError) {
        return c.json(
          { error: "Invalid request", details: error.errors },
          400
        );
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
