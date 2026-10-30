import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  calculateRequiredDeposit,
  calculateGas,
  checkBudgets,
  yoctoToNear,
} from "./budget.js";
import {
  GAS_100_TGAS,
  GAS_150_TGAS,
  CREATE_VAULT_DEPOSIT,
  AGENT_OVERHEAD,
  MIN_AGENT_FUNDING,
  MAX_AGENT_FUNDING,
} from "./constants.js";
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
  globalDailyBudgetNear: 1.0,
  maxDepositPerCallNear: 2.0,
  ownerRateLimitPerHour: 30,
  ownerDailyBudgetNear: 5.0,
  port: 3000,
  nodeEnv: "test",
  logLevel: "error",
  inviteToken: undefined,
  ownerAllowlist: undefined,
  corsOrigins: undefined,
};

describe("Gas constants", () => {
  it("are within valid range", () => {
    expect(Number(GAS_100_TGAS)).toBeGreaterThanOrEqual(1e14);
    expect(Number(GAS_100_TGAS)).toBeLessThan(3e14);
    expect(Number(GAS_150_TGAS)).toBeGreaterThanOrEqual(1e14);
    expect(Number(GAS_150_TGAS)).toBeLessThan(3e14);
  });
});

describe("yoctoToNear", () => {
  it("converts yocto to NEAR correctly", () => {
    expect(yoctoToNear("1000000000000000000000000")).toBe(1.0);
    expect(yoctoToNear("500000000000000000000000")).toBe(0.5);
  });
});

describe("calculateRequiredDeposit", () => {
  it("returns exact 0.5 NEAR for CreateVault", () => {
    const action = {
      type: "CreateVault" as const,
      owner: "owner",
      vault_address: "vault",
      policy: {} as never,
    };
    const deposit = calculateRequiredDeposit(action);
    expect(deposit).toBe(CREATE_VAULT_DEPOSIT.toString());
    expect(yoctoToNear(deposit)).toBe(0.5);
  });

  it("returns exact gas_funding + 0.05 NEAR for AddAgent", () => {
    const gasFunding = 200_000_000_000_000_000_000_000n; // 0.2 NEAR
    const action = {
      type: "AddAgent" as const,
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: gasFunding.toString(),
    };
    const deposit = calculateRequiredDeposit(action);
    const expected = gasFunding + AGENT_OVERHEAD;
    expect(deposit).toBe(expected.toString());
    expect(yoctoToNear(deposit)).toBe(0.25);
  });

  it("throws if AddAgent gas_funding below 0.15 NEAR", () => {
    const action = {
      type: "AddAgent" as const,
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: "100000000000000000000000", // 0.1 NEAR
    };
    expect(() => calculateRequiredDeposit(action)).toThrow("below minimum");
  });

  it("throws if AddAgent gas_funding above 0.5 NEAR", () => {
    const action = {
      type: "AddAgent" as const,
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: "600000000000000000000000", // 0.6 NEAR
    };
    expect(() => calculateRequiredDeposit(action)).toThrow("exceeds maximum");
  });

  it("returns 0 for other actions", () => {
    const action = {
      type: "Pause" as const,
      vault_id: 0,
    };
    const deposit = calculateRequiredDeposit(action);
    expect(deposit).toBe("0");
  });
});

describe("calculateGas", () => {
  it("returns 150 Tgas for AddAgent", () => {
    const action = {
      type: "AddAgent" as const,
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: MIN_AGENT_FUNDING.toString(),
    };
    const gas = calculateGas(action);
    expect(gas).toBe(GAS_150_TGAS.toString());
  });

  it("returns 100 Tgas for other actions", () => {
    const action = {
      type: "CreateVault" as const,
      owner: "owner",
      vault_address: "vault",
      policy: {} as never,
    };
    const gas = calculateGas(action);
    expect(gas).toBe(GAS_100_TGAS.toString());
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
      CREATE_VAULT_DEPOSIT.toString(),
      "100000000000000",
      db,
      testConfig,
      Date.now()
    );
    expect(check.allowed).toBe(true);
  });

  it("rejects request exceeding hard cap", () => {
    const check = checkBudgets(
      "owner1",
      "3000000000000000000000000",
      "100000000000000",
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
      db.reserveBudget(
        "owner1",
        i,
        "CreateVault",
        "100000000000000000000000",
        now - 1000 * i
      );
      db.finalizeBudget("owner1", i, `tx${i}`, true);
    }

    const check = checkBudgets(
      "owner1",
      CREATE_VAULT_DEPOSIT.toString(),
      "100000000000000",
      db,
      testConfig,
      now
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("rate limit");
  });

  it("rejects request exceeding owner daily budget", () => {
    const now = Date.now();
    db.reserveBudget("owner1", 1, "CreateVault", "4500000000000000000000000", now - 1000);
    db.finalizeBudget("owner1", 1, "tx1", true);

    const check = checkBudgets(
      "owner1",
      "600000000000000000000000",
      "100000000000000000000000",
      db,
      testConfig,
      now
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Owner daily budget");
  });

  it("rejects request exceeding global daily budget", () => {
    const now = Date.now();
    for (let i = 0; i < 2; i++) {
      db.reserveBudget(`owner${i}`, 1, "CreateVault", "500000000000000000000000", now);
      db.finalizeBudget(`owner${i}`, 1, `tx${i}`, true);
    }

    const check = checkBudgets(
      "owner99",
      CREATE_VAULT_DEPOSIT.toString(),
      "100000000000000",
      db,
      testConfig,
      now
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Global daily budget");
  });
});
