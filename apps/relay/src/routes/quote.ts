import { Hono } from "hono";
import type { Config } from "../config.js";
import { nearToYocto, yoctoToNear } from "../budget.js";
import { createRequestLogger } from "../logger.js";
import { randomBytes } from "crypto";

export function createQuoteRouter(config: Config) {
  const app = new Hono();

  app.get("/v1/quote/:action", async (c) => {
    const requestId = randomBytes(16).toString("hex");
    const log = createRequestLogger(requestId);

    try {
      const action = c.req.param("action");
      log.info({ action }, "Quote request");

      let depositYocto = "0";

      if (action === "CreateVault") {
        depositYocto = nearToYocto(0.5);
      } else if (action === "AddAgent") {
        const gasFundingParam = c.req.query("gas_funding");
        if (!gasFundingParam) {
          return c.json(
            { error: "gas_funding query parameter required for AddAgent" },
            400
          );
        }

        const gasFunding = parseFloat(gasFundingParam);
        if (isNaN(gasFunding) || gasFunding < 0) {
          return c.json({ error: "Invalid gas_funding value" }, 400);
        }

        if (gasFunding > config.maxAgentGasFundingNear) {
          return c.json(
            {
              error: `gas_funding exceeds maximum of ${config.maxAgentGasFundingNear} NEAR`,
            },
            400
          );
        }

        const gasFundingYocto = nearToYocto(gasFunding);
        const overhead = nearToYocto(0.05);
        depositYocto = (BigInt(gasFundingYocto) + BigInt(overhead)).toString();
      } else if (
        [
          "AddRecipient",
          "RemoveRecipient",
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

      const estimatedGas = nearToYocto(0.1);

      return c.json({
        action,
        depositNear: yoctoToNear(depositYocto),
        depositYocto,
        estimatedGasNear: yoctoToNear(estimatedGas),
        estimatedGasYocto: estimatedGas,
        totalNear:
          yoctoToNear(depositYocto) + yoctoToNear(estimatedGas),
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
