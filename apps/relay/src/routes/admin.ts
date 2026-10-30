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
  estimateGasCost,
  checkBudgets,
  yoctoToNear,
} from "../budget.js";
import { createRequestLogger } from "../logger.js";
import { randomBytes } from "crypto";

const adminRequestSchema = z.object({
  action: z.record(z.unknown()),
  vault: z.number().nullable(),
  nonce: z.number(),
  expiry: z.string(),
  signature: z.array(z.number()).length(64),
});

export function createAdminRouter(
  nearClient: NearClient,
  db: RelayDatabase,
  config: Config
) {
  const app = new Hono();

  app.post("/v1/admin", async (c) => {
    const requestId = randomBytes(16).toString("hex");
    const log = createRequestLogger(requestId);
    const nowMs = Date.now();

    try {
      const body = await c.req.json();
      const parsed = adminRequestSchema.parse(body);
      log.info({ action: parsed.action.type }, "Received admin request");

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

      const msg = buildAdminMessage(
        parsed.action,
        parsed.vault,
        parsed.nonce,
        parsed.expiry,
        config
      );

      const parsedMsg = parseAdminMessage(msg);

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

      let owner: string;
      if (parsedMsg.action.type === "CreateVault") {
        owner = extractOwner(parsedMsg.action);
      } else {
        const vaultId = getVaultId(parsedMsg.action);
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

      const signatureBytes = new Uint8Array(parsed.signature);
      if (!verifySignature(msg, signatureBytes, owner)) {
        log.warn({ owner }, "Invalid signature");
        return c.json({ error: "Invalid signature" }, 401);
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

      const depositYocto = calculateRequiredDeposit(parsedMsg.action, config);
      const gasCostYocto = estimateGasCost();

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

      log.info({ depositYocto, owner, nonce: parsedMsg.nonce }, "Submitting to NEAR");
      const result = await nearClient.submitOwnerAction(
        msg,
        parsed.signature,
        depositYocto
      );

      const totalSpent = (BigInt(depositYocto) + BigInt(gasCostYocto)).toString();
      db.recordRequest(
        owner,
        parsedMsg.nonce,
        totalSpent,
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

function buildAdminMessage(
  action: Record<string, unknown>,
  vault: number | null,
  nonce: number,
  expiry: string,
  config: Config
): string {
  const network = `near-${config.nearNetwork}`;
  const contract = config.guardContractId;
  const vaultStr = vault === null ? "null" : String(vault);
  const actionJson = JSON.stringify(action, null, 0);

  return [
    "SANA-GUARD-ADMIN-v1",
    `network: ${network}`,
    `contract: ${contract}`,
    `vault: ${vaultStr}`,
    `nonce: ${nonce}`,
    `expires: ${expiry}`,
    `action: ${actionJson}`,
  ].join("\n");
}
