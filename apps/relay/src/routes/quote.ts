import { Hono } from "hono";
import { createRequestLogger } from "../logger.js";
import { randomBytes } from "crypto";
import {
  CREATE_VAULT_DEPOSIT,
  AGENT_OVERHEAD,
  MIN_AGENT_FUNDING,
  MAX_AGENT_FUNDING,
  ESTIMATED_GAS_COST,
} from "../constants.js";
import { yoctoToNear } from "../budget.js";
import { readRateLimit } from "../middleware/rateLimit.js";

export function createQuoteRouter() {
  const app = new Hono();

  app.get("/v1/quote/:action", readRateLimit, async (c) => {
    const requestId = randomBytes(16).toString("hex");
    const log = createRequestLogger(requestId);

    try {
      const action = c.req.param("action")!;
      log.info({ action }, "Quote request");

      let depositYocto = "0";

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

        const gasFundingNear = parseFloat(gasFundingParam);
        if (isNaN(gasFundingNear) || gasFundingNear < 0) {
          return c.json({ error: "Invalid gas_funding value" }, 400);
        }

        const gasFundingYocto = BigInt(Math.floor(gasFundingNear * 1e24));

        if (gasFundingYocto < MIN_AGENT_FUNDING) {
          return c.json(
            {
              error: `gas_funding below minimum of ${yoctoToNear(MIN_AGENT_FUNDING.toString())} NEAR`,
            },
            400
          );
        }

        if (gasFundingYocto > MAX_AGENT_FUNDING) {
          return c.json(
            {
              error: `gas_funding exceeds maximum of ${yoctoToNear(MAX_AGENT_FUNDING.toString())} NEAR`,
            },
            400
          );
        }

        depositYocto = (gasFundingYocto + AGENT_OVERHEAD).toString();
      } else if (
        [
          "AddRecipient",
          "RemoveRecipient",
          "BackfillRecipients",
          "RemoveAgent",
          "SetPolicy",
          "Pause",
          "Unpause",
          "RegisterTokenAccount",
          "Release",
        ].includes(action)
      ) {
        depositYocto = "0";
      } else {
        return c.json({ error: "Unknown action type" }, 400);
      }

      return c.json({
        action,
        depositNear: yoctoToNear(depositYocto),
        depositYocto,
        estimatedGasNear: yoctoToNear(ESTIMATED_GAS_COST.toString()),
        estimatedGasYocto: ESTIMATED_GAS_COST.toString(),
        totalNear:
          yoctoToNear(depositYocto) + yoctoToNear(ESTIMATED_GAS_COST.toString()),
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
