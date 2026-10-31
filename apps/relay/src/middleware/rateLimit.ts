import { isIP } from "node:net";
import { Context, Next } from "hono";
import type { Config } from "../config.js";

type ProxyConfig = Pick<
  Config,
  "trustProxy" | "trustProxyHops" | "clientIpHeader"
>;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ADMIN_LIMIT = 10;
const READ_LIMIT = 60;
const WINDOW_MS = 60 * 1000;

const adminLimits = new Map<string, RateLimitEntry>();
const readLimits = new Map<string, RateLimitEntry>();

function parseSingleIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    trimmed = trimmed.slice(1, -1);
  }
  if (!trimmed || trimmed.includes(",") || /\s/.test(trimmed)) {
    return undefined;
  }
  return isIP(trimmed) !== 0 ? trimmed : undefined;
}

function ipFromXff(xff: string | undefined, hops: number): string | undefined {
  if (!xff) return undefined;
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  const index = Math.max(0, parts.length - hops);
  return parseSingleIp(parts[index]);
}

export function getClientIp(
  c: Context,
  opts: {
    trustProxy: boolean;
    trustProxyHops: number;
    clientIpHeader?: string;
  }
): string {
  if (opts.trustProxy) {
    const named = opts.clientIpHeader?.trim().toLowerCase();
    if (named) {
      const fromHeader = parseSingleIp(c.req.header(named));
      if (fromHeader) return fromHeader;
    }
    const fromXff = ipFromXff(
      c.req.header("x-forwarded-for"),
      opts.trustProxyHops
    );
    if (fromXff) return fromXff;
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
      clientIpHeader: config.clientIpHeader,
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
