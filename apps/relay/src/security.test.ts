import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { unlink } from "fs/promises";
import { createCorsMiddleware } from "./middleware/cors.js";
import { bodyLimit, MAX_BODY_SIZE } from "./middleware/bodyLimit.js";
import {
  getClientIp,
  createAdminRateLimit,
  createReadRateLimit,
  adminLimits,
  readLimits,
} from "./middleware/rateLimit.js";
import { tokensEqual } from "./crypto.js";
import { RelayDatabase } from "./db.js";
import { checkInviteGate } from "./routes/admin.js";
import type { Config } from "./config.js";
import { parseNearToYocto } from "./constants.js";
import { defaultOwnerDailyBudget } from "./config.js";

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    relayAccountId: "relay.test.near",
    relayPrivateKey: "ed25519:test",
    nearNetwork: "testnet",
    nearRpcUrl: "http://localhost",
    guardContractId: "guard.test.near",
    databaseUrl: "sqlite:./test-sec.db",
    relayBalanceFloorNear: 0.5,
    maxAgentGasFundingNear: 0.5,
    globalDailyBudgetNear: 1.0,
    maxDepositPerCallNear: 2.0,
    ownerRateLimitPerHour: 30,
    ownerDailyBudgetNear: 0.3,
    port: 3000,
    nodeEnv: "test",
    logLevel: "error",
    inviteToken: "secret-invite",
    ownerAllowlist: undefined,
    corsOrigins: undefined,
    adminGateEnabled: true,
    trustProxy: false,
    trustProxyHops: 1,
    ...overrides,
  };
}

describe("1. CORS closed by default", () => {
  it("does not reflect an arbitrary Origin when CORS_ORIGINS is unset", async () => {
    const app = new Hono();
    app.use("*", createCorsMiddleware(cfg({ corsOrigins: undefined })));
    app.get("/x", (c) => c.json({ ok: true }));

    const res = await app.request("/x", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows only listed origins", async () => {
    const app = new Hono();
    app.use(
      "*",
      createCorsMiddleware(cfg({ corsOrigins: "https://app.example" }))
    );
    app.get("/x", (c) => c.json({ ok: true }));

    const ok = await app.request("/x", {
      headers: { origin: "https://app.example" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe(
      "https://app.example"
    );

    const bad = await app.request("/x", {
      headers: { origin: "https://evil.example" },
    });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("2. Invite token compared in constant time", () => {
  it("matches the configured token and rejects others", () => {
    expect(tokensEqual("secret-invite", "secret-invite")).toBe(true);
    expect(tokensEqual("secret-invite", "wrong")).toBe(false);
    expect(
      checkInviteGate("CreateVault", "owner", "secret-invite", cfg()).allowed
    ).toBe(true);
    expect(
      checkInviteGate("CreateVault", "owner", "wrong", cfg()).allowed
    ).toBe(false);
  });
});

describe("3. Body limit on bytes actually read", () => {
  it("rejects a large body even without Content-Length", async () => {
    const app = new Hono();
    app.post("/v1/admin", bodyLimit, async (c) => {
      await c.req.text();
      return c.json({ ok: true });
    });

    const big = "x".repeat(MAX_BODY_SIZE + 1024);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      // ReadableStream is sent chunked, with no Content-Length.
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
  });
});

describe("4. X-Forwarded-For only when TRUST_PROXY is set", () => {
  function fakeCtx(headers: Record<string, string>, socket = "203.0.113.9") {
    return {
      req: { header: (name: string) => headers[name.toLowerCase()] },
      env: { incoming: { socket: { remoteAddress: socket } } },
    } as never;
  }

  it("uses the socket address when TRUST_PROXY is off", () => {
    const ip = getClientIp(fakeCtx({ "x-forwarded-for": "1.2.3.4" }), {
      trustProxy: false,
      trustProxyHops: 1,
    });
    expect(ip).toBe("203.0.113.9");
  });

  it("uses XFF only when TRUST_PROXY is on", () => {
    const ip = getClientIp(fakeCtx({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }), {
      trustProxy: true,
      trustProxyHops: 1,
    });
    expect(ip).toBe("10.0.0.1");
  });

  it("keeps admin and read limiter maps separate", async () => {
    const prev = process.env.RELAY_TEST_RATE_LIMIT;
    process.env.RELAY_TEST_RATE_LIMIT = "1";
    adminLimits.clear();
    readLimits.clear();

    const app = new Hono();
    const c = cfg();
    app.post("/admin", createAdminRateLimit(c), (ctx) => ctx.json({ ok: true }));
    app.get("/read", createReadRateLimit(c), (ctx) => ctx.json({ ok: true }));
    const env = { incoming: { socket: { remoteAddress: "198.51.100.7" } } };

    let lastAdmin = 200;
    for (let i = 0; i < 11; i++) {
      const res = await app.request(
        "/admin",
        { method: "POST" },
        env
      );
      lastAdmin = res.status;
    }
    expect(lastAdmin).toBe(429);

    const read = await app.request("/read", { method: "GET" }, env);
    expect(read.status).toBe(200);

    if (prev === undefined) delete process.env.RELAY_TEST_RATE_LIMIT;
    else process.env.RELAY_TEST_RATE_LIMIT = prev;
    adminLimits.clear();
    readLimits.clear();
  });
});

describe("5–7. Reservation reconcile, unknown, atomic reserve", () => {
  let db: RelayDatabase;

  beforeEach(() => {
    db = new RelayDatabase("sqlite:./test-sec.db");
  });

  afterEach(async () => {
    db.close();
    await unlink("./test-sec.db").catch(() => {});
  });

  const pause = { type: "Pause" as const, vault_id: 0 };

  it("reconciles a reserved 0.1 NEAR gas estimate down to tokens_burnt", () => {
    const now = Date.now();
    const reserved = parseNearToYocto("0.1", "near").toString();
    const actual = (
      0n + 300_000_000_000_000n
    ).toString(); // 0.0003 NEAR

    db.reserveBudget("ownerA", 1, "Pause", reserved, now);
    expect(db.getGlobalStats(now).spentToday).toBe(reserved);

    db.reconcileBudget("ownerA", 1, actual, "tx1", true, now);
    expect(db.getGlobalStats(now).spentToday).toBe(actual);
    expect(db.getOwnerStats("ownerA", now).spentToday).toBe(actual);
  });

  it("keeps a timeout reservation as unknown instead of releasing it", () => {
    const now = Date.now();
    const reserved = parseNearToYocto("0.1", "near").toString();
    db.reserveBudget("ownerB", 2, "Pause", reserved, now);
    db.markUnknown("ownerB", 2);

    expect(db.checkNonceInFlight("ownerB", 2)).toBe(true);
    expect(db.getGlobalStats(now).spentToday).toBe(reserved);
    expect(db.listUnknownReservations()).toHaveLength(1);
  });

  it("check-and-reserves the global budget atomically across owners", async () => {
    const now = Date.now();
    const config = cfg({
      globalDailyBudgetNear: 0.15,
      ownerDailyBudgetNear: 0.15,
      maxDepositPerCallNear: 2,
    });
    const deposit = "0";
    const gas = parseNearToYocto("0.1", "near").toString();

    const results = await Promise.all([
      db.withGlobalLock(async () =>
        db.tryReserveBudget({
          owner: "o1",
          nonce: 1,
          action: pause,
          depositYocto: deposit,
          gasCostYocto: gas,
          nowMs: now,
          config,
        })
      ),
      db.withGlobalLock(async () =>
        db.tryReserveBudget({
          owner: "o2",
          nonce: 1,
          action: pause,
          depositYocto: deposit,
          gasCostYocto: gas,
          nowMs: now,
          config,
        })
      ),
    ]);

    const oks = results.filter((r) => r.ok).length;
    expect(oks).toBe(1);
    expect(results.some((r) => !r.ok && "reason" in r)).toBe(true);
  });

  it("defaults the per-owner daily budget to 0.3 of the global budget", () => {
    expect(defaultOwnerDailyBudget("1.0")).toBe("0.3");
    expect(defaultOwnerDailyBudget("2")).toBe("0.6");
    expect(parseNearToYocto(defaultOwnerDailyBudget("1"), "near")).toBe(
      (parseNearToYocto("1", "near") * 3n) / 10n
    );
  });

  it("resolves an unknown reservation later via tx status", async () => {
    const now = Date.now();
    const reserved = parseNearToYocto("0.1", "near").toString();
    db.reserveBudget("ownerC", 3, "Pause", reserved, now);
    db.markUnknown("ownerC", 3, "tx-later");

    const resolved = await db.resolveUnknownReservations(async (hash) => {
      expect(hash).toBe("tx-later");
      return "failure";
    });
    expect(resolved).toBe(1);
    expect(db.checkNonceInFlight("ownerC", 3)).toBe(false);
    expect(db.getGlobalStats(now).spentToday).toBe("0");
    expect(db.listUnknownReservations()).toHaveLength(0);
  });

  it("leaves an unknown reservation without a hash reserved", async () => {
    const now = Date.now();
    const reserved = parseNearToYocto("0.1", "near").toString();
    db.reserveBudget("ownerD", 4, "Pause", reserved, now);
    db.markUnknown("ownerD", 4);

    const resolved = await db.resolveUnknownReservations(async () => "success");
    expect(resolved).toBe(0);
    expect(db.checkNonceInFlight("ownerD", 4)).toBe(true);
    expect(db.getGlobalStats(now).spentToday).toBe(reserved);
  });
});
