import { Hono } from "hono";
import type { NearClient } from "../near/interface.js";
import type { Config } from "../config.js";
import { yoctoToNear } from "../budget.js";
import { createReadRateLimit } from "../middleware/rateLimit.js";

export function createHealthRouter(nearClient: NearClient, config: Config) {
  const app = new Hono();

  app.get("/v1/health", createReadRateLimit(config), async (c) => {
    try {
      const balance = await nearClient.getBalance();
      const balanceNear = yoctoToNear(balance);
      const healthy = balanceNear >= config.relayBalanceFloorNear;

      const status = {
        status: healthy ? "healthy" : "degraded",
        relayBalanceNear: balanceNear,
        relayBalanceFloor: config.relayBalanceFloorNear,
        network: config.nearNetwork,
        guardContract: config.guardContractId,
      };

      return c.json(status, healthy ? 200 : 503);
    } catch {
      return c.json({ status: "unhealthy", error: "Health check failed" }, 503);
    }
  });

  return app;
}
