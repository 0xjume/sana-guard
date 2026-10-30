import { Hono } from "hono";
import { createRequestLogger } from "../logger.js";
import { randomBytes } from "crypto";
import {
  CREATE_VAULT_DEPOSIT,
  GAS_100_TGAS,
  GAS_150_TGAS,
  parseNearToYocto,
  yoctoToNearString,
  maxGasCostYocto,
} from "../constants.js";
import { addAgentDeposit } from "../budget.js";
import { readRateLimit } from "../middleware/rateLimit.js";

const ZERO_DEPOSIT_ACTIONS = [
  "AddRecipient",
  "RemoveRecipient",
  "BackfillRecipients",
  "RemoveAgent",
  "SetPolicy",
  "Pause",
  "Unpause",
  "RegisterTokenAccount",
  "Release",
];

export function createQuoteRouter() {
  const app = new Hono();

  app.get("/v1/quote/:action", readRateLimit, async (c) => {
    const requestId = randomBytes(16).toString("hex");
    const log = createRequestLogger(requestId);

    try {
      const action = c.req.param("action")!;
      log.info({ action }, "Quote request");

      let depositYocto = "0";
      let gasUnits = GAS_100_TGAS;

      if (action === "CreateVault") {
        depositYocto = CREATE_VAULT_DEPOSIT.toString();
      } else if (action === "AddAgent") {
        const gasFundingParam = c.req.query("gas_funding");
        if (!gasFundingParam) {
          return c.json(
            { error: "gas_funding query parameter required for AddAgent" },
            400
          );
        }

        let gasFundingYocto: bigint;
        try {
          gasFundingYocto = parseNearToYocto(gasFundingParam);
        } catch {
          return c.json({ error: "Invalid gas_funding value" }, 400);
        }

        try {
          depositYocto = addAgentDeposit(gasFundingYocto);
        } catch (error: unknown) {
          return c.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Invalid gas_funding value",
            },
            400
          );
        }
        gasUnits = GAS_150_TGAS;
      } else if (ZERO_DEPOSIT_ACTIONS.includes(action)) {
        depositYocto = "0";
      } else {
        return c.json({ error: "Unknown action type" }, 400);
      }

      const estimatedGasYocto = maxGasCostYocto(gasUnits).toString();

      return c.json({
        action,
        depositNear: yoctoToNearString(depositYocto),
        depositYocto,
        estimatedGasNear: yoctoToNearString(estimatedGasYocto),
        estimatedGasYocto,
        totalYocto: (BigInt(depositYocto) + BigInt(estimatedGasYocto)).toString(),
        totalNear: yoctoToNearString(
          BigInt(depositYocto) + BigInt(estimatedGasYocto)
        ),
      });
    } catch (error: unknown) {
      log.error({ error }, "Quote request failed");
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
