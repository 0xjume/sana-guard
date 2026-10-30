import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  calculateRequiredDeposit,
  checkBudgets,
  nearToYocto,
  yoctoToNear,
} from "./budget.js";
import { RelayDatabase } from "./db.js";
import type { Config } from "./config.js";
import { unlink } from "fs/promises";

const testConfig: Config = {
  relayAccountId: "relay.test.near",
  relayPrivateKey: "ed25519:test",
  nearNetwork: "testnet",
  nearRpcUrl: "http://localhost",
  guardContractId: "guard.test.near",
  databaseUrl: "sqlite:./test-budget.db",
  relayBalanceFloorNear: 0.5,
  maxAgentGasFundingNear: 0.5,
  globalDailyBudgetNear: 10.0,
  maxDepositPerCallNear: 2.0,
  ownerRateLimitPerHour: 30,
  ownerDailyBudgetNear: 5.0,
  port: 3000,
  nodeEnv: "test",
  logLevel: "error",
};

describe("nearToYocto and yoctoToNear", () => {
  it("converts NEAR to yocto correctly", () => {
    expect(nearToYocto(1.0)).toBe("1000000000000000000000000");
    expect(nearToYocto(0.5)).toBe("500000000000000000000000");
  });

  it("converts yocto to NEAR correctly", () => {
    expect(yoctoToNear("1000000000000000000000000")).toBe(1.0);
    expect(yoctoToNear("500000000000000000000000")).toBe(0.5);
  });
});

describe("calculateRequiredDeposit", () => {
  it("returns 0.5 NEAR for CreateVault", () => {
    const action = {
      type: "CreateVault" as const,
      owner: "owner",
      vault_address: "vault",
      policy: {} as never,
    };
    const deposit = calculateRequiredDeposit(action, testConfig);
    expect(yoctoToNear(deposit)).toBe(0.5);
  });

  it("returns gas_funding + 0.05 NEAR for AddAgent", () => {
    const action = {
      type: "AddAgent" as const,
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: nearToYocto(0.2),
    };
    const deposit = calculateRequiredDeposit(action, testConfig);
    expect(yoctoToNear(deposit)).toBeCloseTo(0.25, 6);
  });

  it("throws if AddAgent gas_funding exceeds max", () => {
    const action = {
      type: "AddAgent" as const,
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: nearToYocto(0.6),
    };
    expect(() => calculateRequiredDeposit(action, testConfig)).toThrow(
      "exceeds max"
    );
  });

  it("returns 0 for other actions", () => {
    const action = {
      type: "Pause" as const,
      vault_id: 0,
    };
    const deposit = calculateRequiredDeposit(action, testConfig);
    expect(deposit).toBe("0");
  });
});

describe("checkBudgets", () => {
  let db: RelayDatabase;

  beforeEach(() => {
    db = new RelayDatabase("sqlite:./test-budget-check.db");
  });

  afterEach(async () => {
    db.close();
    await unlink("./test-budget-check.db").catch(() => {});
  });

  it("allows request within all limits", () => {
    const check = checkBudgets(
      "owner1",
      nearToYocto(0.5),
      nearToYocto(0.1),
      db,
      testConfig,
      Date.now()
    );
    expect(check.allowed).toBe(true);
  });

  it("rejects request exceeding hard cap", () => {
    const check = checkBudgets(
      "owner1",
      nearToYocto(3.0),
      nearToYocto(0.1),
      db,
      testConfig,
      Date.now()
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("hard cap");
  });

  it("rejects request exceeding owner rate limit", () => {
    const now = Date.now();
    for (let i = 0; i < 30; i++) {
      db.recordRequest(
        "owner1",
        i,
        nearToYocto(0.1),
        `tx${i}`,
        true,
        now - 1000 * i
      );
    }

    const check = checkBudgets(
      "owner1",
      nearToYocto(0.5),
      nearToYocto(0.1),
      db,
      testConfig,
      now
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("rate limit");
  });

  it("rejects request exceeding owner daily budget", () => {
    const now = Date.now();
    db.recordRequest("owner1", 1, nearToYocto(4.5), "tx1", true, now - 1000);

    const check = checkBudgets(
      "owner1",
      nearToYocto(0.6),
      nearToYocto(0.1),
      db,
      testConfig,
      now
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Owner daily budget");
  });

  it("rejects request exceeding global daily budget", () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      db.recordRequest(`owner${i}`, 1, nearToYocto(1.0), `tx${i}`, true, now);
    }

    const check = checkBudgets(
      "owner99",
      nearToYocto(0.5),
      nearToYocto(0.1),
      db,
      testConfig,
      now
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Global daily budget");
  });
});
