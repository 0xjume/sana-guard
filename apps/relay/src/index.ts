import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "./logger.js";
import { loadConfig } from "./config.js";
import { NearClientImpl } from "./near/client.js";
import { RelayDatabase } from "./db.js";
import { createAdminRouter } from "./routes/admin.js";
import { createVaultsRouter } from "./routes/vaults.js";
import { createQuoteRouter } from "./routes/quote.js";
import { createHealthRouter } from "./routes/health.js";
import { createCorsMiddleware } from "./middleware/cors.js";
import { createUnknownResolver } from "./resolve.js";

async function main() {
  const config = loadConfig();

  logger.info(
    {
      network: config.nearNetwork,
      guardContract: config.guardContractId,
      relayAccount: config.relayAccountId,
    },
    "Starting Sana Guard Relay"
  );

  const nearClient = new NearClientImpl(
    config.nearNetwork,
    config.nearRpcUrl,
    config.relayAccountId,
    config.relayPrivateKey,
    config.guardContractId
  );

  const db = new RelayDatabase(config.databaseUrl);

  const cleanupInterval = setInterval(
    () => {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      db.cleanupOldData(sevenDaysAgo);
    },
    24 * 60 * 60 * 1000
  );

  const resolveUnknowns = createUnknownResolver(db, nearClient);
  const resolveInterval = setInterval(() => {
    void resolveUnknowns();
  }, 60 * 1000);

  const app = new Hono();

  app.use("*", createCorsMiddleware(config));

  app.get("/", (c) => {
    return c.json({
      service: "Sana Guard Relay",
      version: "0.1.0",
      network: config.nearNetwork,
    });
  });

  app.route("/", createAdminRouter(nearClient, db, config));
  app.route("/", createVaultsRouter(nearClient, config));
  app.route("/", createQuoteRouter(config));
  app.route("/", createHealthRouter(nearClient, config));

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      logger.info({ port: info.port }, "Relay server listening");
    }
  );

  const shutdown = () => {
    logger.info("Shutting down gracefully");
    clearInterval(cleanupInterval);
    clearInterval(resolveInterval);
    db.close();
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  logger.error({ error }, "Fatal error");
  process.exit(1);
});
