import { Hono } from "hono";
import type { NearClient } from "../near/interface.js";
import { createRequestLogger } from "../logger.js";
import { randomBytes } from "crypto";
import { readRateLimit } from "../middleware/rateLimit.js";

export function createVaultsRouter(nearClient: NearClient) {
  const app = new Hono();

  app.get("/v1/vaults/:id", readRateLimit, async (c) => {
    const requestId = randomBytes(16).toString("hex");
    const log = createRequestLogger(requestId);

    try {
      const id = parseInt(c.req.param("id")!, 10);
      if (isNaN(id) || id < 0) {
        return c.json({ error: "Invalid vault ID" }, 400);
      }

      log.info({ vaultId: id }, "Fetching vault");
      const vault = await nearClient.getVault(id);

      if (!vault) {
        return c.json({ error: "Vault not found" }, 404);
      }

      return c.json(vault);
    } catch (error: unknown) {
      log.error({ error }, "Failed to fetch vault");
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
