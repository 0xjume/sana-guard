import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  addAgentDeposit,
  calculateRequiredDeposit,
  calculateGas,
  checkBudgets,
  estimateGasCostYocto,
  wouldBreachFloor,
} from "./budget.js";
import {
  GAS_100_TGAS,
  GAS_150_TGAS,
  CREATE_VAULT_DEPOSIT,
  AGENT_OVERHEAD,
  MIN_AGENT_FUNDING,
  parseNearToYocto,
  maxGasCostYocto,
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
  relayBalanceFloorYocto: parseNearToYocto("0.5", "near"),
  maxAgentGasFundingYocto: parseNearToYocto("0.5", "near"),
  globalDailyBudgetYocto: parseNearToYocto("1.0", "near"),
  maxDepositPerCallYocto: parseNearToYocto("2.0", "near"),
  ownerRateLimitPerHour: 30,
  ownerDailyBudgetYocto: parseNearToYocto("5.0", "near"),
  port: 3000,
  nodeEnv: "test",
  logLevel: "error",
  inviteToken: undefined,
  ownerAllowlist: undefined,
  corsOrigins: undefined,
  adminGateEnabled: true,
  trustProxy: false,
  trustProxyHops: 1,
};

describe("Gas constants", () => {
  it("are at least 1e14 and below 3e14", () => {
    expect(GAS_100_TGAS >= 100_000_000_000_000n).toBe(true);
    expect(GAS_100_TGAS < 300_000_000_000_000n).toBe(true);
    expect(GAS_150_TGAS >= 100_000_000_000_000n).toBe(true);
    expect(GAS_150_TGAS < 300_000_000_000_000n).toBe(true);
    expect(Number(GAS_100_TGAS)).toBeGreaterThanOrEqual(1e14);
    expect(Number(GAS_100_TGAS)).toBeLessThan(3e14);
    expect(Number(GAS_150_TGAS)).toBeGreaterThanOrEqual(1e14);
    expect(Number(GAS_150_TGAS)).toBeLessThan(3e14);
  });
});

describe("parseNearToYocto", () => {
  it("parses unit=near decimals exactly", () => {
    expect(parseNearToYocto("0.15", "near")).toBe(MIN_AGENT_FUNDING);
    expect(parseNearToYocto("0.5", "near")).toBe(CREATE_VAULT_DEPOSIT);
    expect(parseNearToYocto("1", "near")).toBe(1_000_000_000_000_000_000_000_000n);
    expect(parseNearToYocto("0.05", "near")).toBe(AGENT_OVERHEAD);
  });

  it("parses unit=yocto integers as-is and rejects NEAR decimals", () => {
    expect(parseNearToYocto("150000000000000000000000", "yocto")).toBe(
      MIN_AGENT_FUNDING
    );
    expect(() => parseNearToYocto("0.15", "yocto")).toThrow("Invalid yocto");
    expect(() => parseNearToYocto("150000000000000000000000", "near")).not.toThrow();
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
    expect(deposit).toBe("500000000000000000000000");
  });

  it("returns exact BigInt(gas_funding) + overhead for AddAgent", () => {
    const gasFunding = parseNearToYocto("0.15", "near");
    const action = {
      type: "AddAgent" as const,
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: gasFunding.toString(),
    };
    const deposit = calculateRequiredDeposit(action);
    expect(deposit).toBe((gasFunding + AGENT_OVERHEAD).toString());
    expect(deposit).toBe(addAgentDeposit(gasFunding));
    expect(deposit).toBe("200000000000000000000000");
  });

  it("quote and submit agree for 0.15 AddAgent funding", () => {
    const funding = parseNearToYocto("0.15", "near");
    const fromAction = calculateRequiredDeposit({
      type: "AddAgent",
      vault_id: 0,
      name: "agent1",
      public_key: "ed25519:test",
      gas_funding: funding.toString(),
    });
    const fromQuote = addAgentDeposit(parseNearToYocto("0.15", "near"));
    expect(fromAction).toBe(fromQuote);
    expect(fromAction).toBe("200000000000000000000000");
  });

  it("throws if AddAgent gas_funding below 0.15 NEAR", () => {
    expect(() =>
      calculateRequiredDeposit({
        type: "AddAgent",
        vault_id: 0,
        name: "agent1",
        public_key: "ed25519:test",
        gas_funding: "100000000000000000000000",
      })
    ).toThrow("below minimum");
  });

  it("throws if AddAgent gas_funding above 0.5 NEAR", () => {
    expect(() =>
      calculateRequiredDeposit({
        type: "AddAgent",
        vault_id: 0,
        name: "agent1",
        public_key: "ed25519:test",
        gas_funding: "600000000000000000000000",
      })
    ).toThrow("exceeds maximum");
  });

  it("returns 0 for BackfillRecipients and other actions", () => {
    expect(
      calculateRequiredDeposit({
        type: "BackfillRecipients",
        vault_id: 0,
        recipients: ["DeF8"],
      })
    ).toBe("0");
    expect(calculateRequiredDeposit({ type: "Pause", vault_id: 0 })).toBe("0");
  });
});

describe("calculateGas", () => {
  it("returns 150 Tgas for AddAgent and 100 Tgas otherwise", () => {
    expect(
      calculateGas({
        type: "AddAgent",
        vault_id: 0,
        name: "agent1",
        public_key: "ed25519:test",
        gas_funding: MIN_AGENT_FUNDING.toString(),
      })
    ).toBe(GAS_150_TGAS.toString());
    expect(
      calculateGas({
        type: "CreateVault",
        owner: "owner",
        vault_address: "vault",
        policy: {} as never,
      })
    ).toBe(GAS_100_TGAS.toString());
    expect(BigInt(estimateGasCostYocto({ type: "Pause", vault_id: 0 }))).toBe(
      maxGasCostYocto(GAS_100_TGAS)
    );
  });
});

describe("wouldBreachFloor", () => {
  it("rejects CreateVault when remaining would fall below the floor", () => {
    const balance = parseNearToYocto("0.66", "near");
    const deposit = CREATE_VAULT_DEPOSIT;
    const gas = maxGasCostYocto(GAS_100_TGAS);
    const floor = parseNearToYocto("0.5", "near");
    expect(
      wouldBreachFloor(balance.toString(), deposit.toString(), gas.toString(), floor)
    ).toBe(true);
  });

  it("allows a send that leaves the floor intact", () => {
    const balance = parseNearToYocto("1.2", "near");
    expect(
      wouldBreachFloor(
        balance.toString(),
        CREATE_VAULT_DEPOSIT.toString(),
        maxGasCostYocto(GAS_100_TGAS).toString(),
        parseNearToYocto("0.5", "near")
      )
    ).toBe(false);
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
      maxGasCostYocto(GAS_100_TGAS).toString(),
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
      "0",
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
      "0",
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
      "0",
      db,
      testConfig,
      now
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Global daily budget");
  });
});
