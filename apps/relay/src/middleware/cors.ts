import { Context, Next } from "hono";
import type { Config } from "../config.js";

export function createCorsMiddleware(config: Config) {
  const allowedOrigins = config.corsOrigins
    ? config.corsOrigins.split(",").map((o) => o.trim())
    : ["*"];

  return async (c: Context, next: Next) => {
    const origin = c.req.header("origin");

    if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Invite-Token");
      c.header("Access-Control-Max-Age", "3600");
    }

    if (c.req.method === "OPTIONS") {
      return new Response("", { status: 204 });
    }

    await next();
  };
}
