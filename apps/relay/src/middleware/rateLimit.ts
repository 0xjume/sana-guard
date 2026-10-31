import { isIP } from "node:net";
import { Context, Next } from "hono";
import type { Config } from "../config.js";

type ProxyConfig = Pick<
  Config,
  "trustProxy" | "trustProxyHops" | "clientIpHeader" | "rateLimitIpv6Prefix"
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

function expandIpv6(ip: string): number[] | undefined {
  let s = ip.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    s = s.slice(1, -1);
  }
  const zone = s.indexOf("%");
  if (zone !== -1) {
    s = s.slice(0, zone);
  }

  const v4tail = s.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4tail) {
    const octets = v4tail[1]!.split(".").map((n) => Number(n));
    if (octets.length !== 4 || octets.some((n) => n > 255)) {
      return undefined;
    }
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    s = `${s.slice(0, -v4tail[1]!.length)}${hi}:${lo}`;
  }

  if (s.includes("::")) {
    const [left = "", right = ""] = s.split("::");
    const parse = (part: string) =>
      part === "" ? [] : part.split(":").map((g) => parseInt(g, 16));
    const l = parse(left);
    const r = parse(right);
    if (l.some((n) => Number.isNaN(n)) || r.some((n) => Number.isNaN(n))) {
      return undefined;
    }
    if (l.length + r.length >= 8) return undefined;
    return [...l, ...Array<number>(8 - l.length - r.length).fill(0), ...r];
  }

  const groups = s.split(":").map((g) => parseInt(g, 16));
  if (
    groups.length !== 8 ||
    groups.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)
  ) {
    return undefined;
  }
  return groups;
}

function ipv4MappedAddress(ip: string): string | undefined {
  const groups = expandIpv6(ip);
  if (!groups) return undefined;
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    const a = (groups[6]! >> 8) & 0xff;
    const b = groups[6]! & 0xff;
    const c = (groups[7]! >> 8) & 0xff;
    const d = groups[7]! & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }
  return undefined;
}

function maskIpv6(groups: number[], prefix: number): number[] {
  const bits = Math.min(128, Math.max(0, prefix));
  return groups.map((group, i) => {
    const start = i * 16;
    if (start >= bits) return 0;
    if (start + 16 <= bits) return group;
    const keep = bits - start;
    return group & ((0xffff << (16 - keep)) & 0xffff);
  });
}

/** Bucket key: IPv4 per address; IPv4-mapped IPv6 → IPv4; other IPv6 → prefix. */
export function rateLimitKey(ip: string, ipv6Prefix: number): string {
  const trimmed = ip.trim();
  if (isIP(trimmed) === 4) {
    return trimmed;
  }
  if (isIP(trimmed) === 6) {
    const mapped = ipv4MappedAddress(trimmed);
    if (mapped) return mapped;
    const groups = expandIpv6(trimmed);
    if (!groups) return trimmed;
    const masked = maskIpv6(groups, ipv6Prefix);
    const hex = masked.map((g) => g.toString(16).padStart(4, "0")).join(":");
    return `${hex}/${ipv6Prefix}`;
  }
  return trimmed;
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
    const key = rateLimitKey(ip, config.rateLimitIpv6Prefix);
    const now = Date.now();
    sweep(map, now);

    let entry = map.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      map.set(key, entry);
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
