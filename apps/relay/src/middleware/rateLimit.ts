import { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipRateLimits = new Map<string, RateLimitEntry>();
const ADMIN_LIMIT = 10;
const READ_LIMIT = 60;
const WINDOW_MS = 60 * 1000;

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

export function rateLimit(limit: number) {
  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);
    const now = Date.now();

    let entry = ipRateLimits.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      ipRateLimits.set(ip, entry);
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

export const adminRateLimit = rateLimit(ADMIN_LIMIT);
export const readRateLimit = rateLimit(READ_LIMIT);

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRateLimits.entries()) {
    if (now > entry.resetAt) {
      ipRateLimits.delete(ip);
    }
  }
}, 60 * 1000);
