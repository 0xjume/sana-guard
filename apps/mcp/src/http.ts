import { randomUUID } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { GuardConfig } from "./config.js";
import { createMcpServer } from "./server.js";
import type { GuardRuntime } from "./runtime.js";

export async function serveHttp(runtime: GuardRuntime, config: GuardConfig): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const existing = typeof sessionId === "string" ? transports.get(sessionId) : undefined;

    try {
      if (existing) {
        await existing.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) {
            transports.delete(id);
          }
        };
        const server = createMcpServer(runtime);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no MCP session" },
        id: null,
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
          id: null,
        });
      }
    }
  });

  const sessionHandler = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing MCP session");
      return;
    }
    await transport.handleRequest(req, res);
  };

  app.get("/mcp", sessionHandler);
  app.delete("/mcp", sessionHandler);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "sana-guard-mcp" });
  });

  await new Promise<void>((resolve) => {
    app.listen(config.httpPort, config.httpHost, () => {
      console.error(`sana-guard MCP HTTP on http://${config.httpHost}:${config.httpPort}/mcp`);
      resolve();
    });
  });
}
