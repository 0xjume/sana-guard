import { Context, Next } from "hono";
import type { Config } from "../config.js";

type ProxyConfig = Pick<Config, "trustProxy" | "trustProxyHops">;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ADMIN_LIMIT = 10;
const READ_LIMIT = 60;
const WINDOW_MS = 60 * 1000;

const adminLimits = new Map<string, RateLimitEntry>();
const readLimits = new Map<string, RateLimitEntry>();

export function getClientIp(
  c: Context,
  opts: { trustProxy: boolean; trustProxyHops: number }
): string {
  if (opts.trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
      const index = Math.max(0, hops.length - opts.trustProxyHops);
      const picked = hops[index];
      if (picked) return picked;
    }
  }

  const env = c.env as
    | { incoming?: { socket?: { remoteAddress?: string } } }
    | undefined;
  return env?.incoming?.socket?.remoteAddress || "unknown";
}

function sweep(map: Map<string, RateLimitEntry>, now: number): void {
  for (const [ip, entry] of map.entries()) {
    if (now > entry.resetAt) {
      map.delete(ip);
    }
  }
}

export function createRateLimit(
  map: Map<string, RateLimitEntry>,
  limit: number,
  config: ProxyConfig
) {
  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === "test" && process.env.RELAY_TEST_RATE_LIMIT !== "1") {
      await next();
      return;
    }

    const ip = getClientIp(c, {
      trustProxy: config.trustProxy,
      trustProxyHops: config.trustProxyHops,
    });
    const now = Date.now();
    sweep(map, now);

    let entry = map.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      map.set(ip, entry);
    }

    if (entry.count >= limit) {
      return c.json(
        { error: "Rate limit exceeded", retryAfter: entry.resetAt - now },
        429
      );
    }

    entry.count++;
    await next();
  };
}

export function createAdminRateLimit(config: ProxyConfig) {
  return createRateLimit(adminLimits, ADMIN_LIMIT, config);
}

export function createReadRateLimit(config: ProxyConfig) {
  return createRateLimit(readLimits, READ_LIMIT, config);
}

export { adminLimits, readLimits };
