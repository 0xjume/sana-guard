import { Context, Next } from "hono";
import type { Config } from "../config.js";

export function allowedCorsOrigins(config: Config): string[] {
  if (!config.corsOrigins?.trim()) {
    return [];
  }
  return config.corsOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function createCorsMiddleware(config: Config) {
  const allowedOrigins = allowedCorsOrigins(config);

  return async (c: Context, next: Next) => {
    const origin = c.req.header("origin");

    if (origin && allowedOrigins.includes(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Invite-Token"
      );
      c.header("Access-Control-Max-Age", "3600");
    }

    if (c.req.method === "OPTIONS") {
      // Must go through Hono so c.header() values are kept on the 204.
      return c.body(null, 204);
    }

    await next();
  };
}
