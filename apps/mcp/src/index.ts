#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { applyHttpRequirements, loadConfig } from "./config.js";
import { serveHttp } from "./http.js";
import { createRuntime } from "./runtime.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const wantHttp = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";
  const config = loadConfig();
  if (wantHttp) {
    config.transport = "http";
    applyHttpRequirements(config);
  }

  const runtime = await createRuntime(config);

  if (config.transport === "http") {
    await serveHttp(runtime, config);
    return;
  }

  const server = createMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "fatal";
  console.error(message);
  process.exit(1);
});
