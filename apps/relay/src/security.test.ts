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
import { defaultOwnerDailyBudgetYocto } from "./config.js";
import { wouldBreachFloor } from "./budget.js";

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    relayAccountId: "relay.test.near",
    relayPrivateKey: "ed25519:test",
    nearNetwork: "testnet",
    nearRpcUrl: "http://localhost",
    guardContractId: "guard.test.near",
    databaseUrl: "sqlite:./test-sec.db",
    relayBalanceFloorYocto: parseNearToYocto("0.5", "near"),
    maxAgentGasFundingYocto: parseNearToYocto("0.5", "near"),
    globalDailyBudgetYocto: parseNearToYocto("1.0", "near"),
    maxDepositPerCallYocto: parseNearToYocto("2.0", "near"),
    ownerRateLimitPerHour: 30,
    ownerDailyBudgetYocto: parseNearToYocto("0.3", "near"),
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

  it("does not treat * as a wildcard", async () => {
    const app = new Hono();
    app.use("*", createCorsMiddleware(cfg({ corsOrigins: "*" })));
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

  it("returns CORS headers on OPTIONS for an allowed origin, none for a disallowed one", async () => {
    const app = new Hono();
    app.use(
      "*",
      createCorsMiddleware(cfg({ corsOrigins: "https://dash.example" }))
    );
    app.post("/v1/admin", (c) => c.json({ ok: true }));

    const ok = await app.request("/v1/admin", {
      method: "OPTIONS",
      headers: {
        origin: "https://dash.example",
        "access-control-request-method": "POST",
      },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(
      "https://dash.example"
    );
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST");
    expect(ok.headers.get("access-control-allow-headers")).toContain(
      "X-Invite-Token"
    );

    const bad = await app.request("/v1/admin", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(bad.status).toBe(204);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    expect(bad.headers.get("access-control-allow-methods")).toBeNull();
    expect(bad.headers.get("access-control-allow-headers")).toBeNull();
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
      globalDailyBudgetYocto: parseNearToYocto("0.15", "near"),
      ownerDailyBudgetYocto: parseNearToYocto("0.15", "near"),
      maxDepositPerCallYocto: parseNearToYocto("2", "near"),
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

  it("floor check-and-reserve subtracts outstanding reservations", async () => {
    const now = Date.now();
    const config = cfg({
      globalDailyBudgetYocto: parseNearToYocto("2", "near"),
      ownerDailyBudgetYocto: parseNearToYocto("2", "near"),
      maxDepositPerCallYocto: parseNearToYocto("2", "near"),
      relayBalanceFloorYocto: parseNearToYocto("0.5", "near"),
    });
    const gas = parseNearToYocto("0.1", "near").toString();
    const balance = parseNearToYocto("0.65", "near").toString();
    const floor = parseNearToYocto("0.5", "near");

    const first = await db.withGlobalLock(async () => {
      const outstanding = db.getOutstandingReservedYocto();
      const available = (BigInt(balance) - BigInt(outstanding)).toString();
      if (wouldBreachFloor(available, "0", gas, floor)) {
        return { ok: false as const, reason: "floor" };
      }
      return db.tryReserveBudget({
        owner: "floor1",
        nonce: 1,
        action: pause,
        depositYocto: "0",
        gasCostYocto: gas,
        nowMs: now,
        config,
      });
    });
    expect(first.ok).toBe(true);

    const second = await db.withGlobalLock(async () => {
      const outstanding = db.getOutstandingReservedYocto();
      const available = (BigInt(balance) - BigInt(outstanding)).toString();
      if (wouldBreachFloor(available, "0", gas, floor)) {
        return { ok: false as const, reason: "floor" };
      }
      return db.tryReserveBudget({
        owner: "floor2",
        nonce: 1,
        action: pause,
        depositYocto: "0",
        gasCostYocto: gas,
        nowMs: now,
        config,
      });
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("floor");
    expect(db.getOutstandingReservedYocto()).toBe(gas);
  });

  it("defaults the per-owner daily budget to 0.3 of the global budget", () => {
    expect(defaultOwnerDailyBudgetYocto("1.0")).toBe(
      parseNearToYocto("0.3", "near")
    );
    expect(defaultOwnerDailyBudgetYocto("2")).toBe(
      parseNearToYocto("0.6", "near")
    );
  });

  it("resolves an unknown reservation later and records burnt, including on failure", async () => {
    const now = Date.now();
    const reserved = parseNearToYocto("0.1", "near").toString();
    const burnt = "300000000000000";
    db.reserveBudget("ownerC", 3, "Pause", reserved, now, {
      depositYocto: "0",
    });
    db.markUnknown("ownerC", 3, "tx-later");

    const resolved = await db.resolveUnknownReservations({
      checkTx: async (hash) => {
        expect(hash).toBe("tx-later");
        return { status: "failure", tokensBurntYocto: burnt };
      },
      checkOwnerNonce: async () => 0,
      nowMs: now,
      txValidityMs: 24 * 60 * 60 * 1000,
    });
    expect(resolved).toBe(1);
    expect(db.checkNonceInFlight("ownerC", 3)).toBe(false);
    expect(db.getGlobalStats(now).spentToday).toBe(burnt);
    expect(db.listUnknownReservations()).toHaveLength(0);
  });

  it("leaves a no-hash unknown reserved until expiry + tx validity, then settles via nonce", async () => {
    const now = Date.now();
    const reserved = parseNearToYocto("0.1", "near").toString();
    db.reserveBudget("ownerD", 4, "Pause", reserved, now, {
      expiresAtMs: now,
    });
    db.markUnknown("ownerD", 4);

    const windowMs = 5_000;
    const stillHeld = await db.resolveUnknownReservations({
      checkTx: async () => ({ status: "success" }),
      checkOwnerNonce: async () => 0,
      nowMs: now + 1000,
      txValidityMs: windowMs,
    });
    expect(stillHeld).toBe(0);
    expect(db.checkNonceInFlight("ownerD", 4)).toBe(true);

    const settleAt = now + windowMs + 1;
    const released = await db.resolveUnknownReservations({
      checkTx: async () => ({ status: "success" }),
      checkOwnerNonce: async () => 3,
      nowMs: settleAt,
      txValidityMs: windowMs,
    });
    expect(released).toBe(1);
    expect(db.checkNonceInFlight("ownerD", 4)).toBe(false);
    expect(db.getGlobalStats(settleAt).spentToday).toBe("0");
  });
});
