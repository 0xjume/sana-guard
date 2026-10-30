import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { unlink } from "fs/promises";
import { createAdminRouter, checkInviteGate } from "./routes/admin.js";
import { createQuoteRouter } from "./routes/quote.js";
import { RelayDatabase } from "./db.js";
import type { Config } from "./config.js";
import type { NearClient, NearTransaction, VaultInfo } from "./near/interface.js";
import { CREATE_VAULT_DEPOSIT, parseNearToYocto } from "./constants.js";

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    relayAccountId: "relay.test.near",
    relayPrivateKey: "ed25519:test",
    nearNetwork: "testnet",
    nearRpcUrl: "http://localhost",
    guardContractId: "guard.djume.testnet",
    databaseUrl: "sqlite:./test-admin.db",
    relayBalanceFloorNear: 0.5,
    maxAgentGasFundingNear: 0.5,
    globalDailyBudgetNear: 1.0,
    maxDepositPerCallNear: 2.0,
    ownerRateLimitPerHour: 30,
    ownerDailyBudgetNear: 5.0,
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

function signMsg(msg: string, secretKey: Uint8Array): number[] {
  return Array.from(nacl.sign.detached(new TextEncoder().encode(msg), secretKey));
}

function makeAdminMsg(opts: {
  network?: string;
  contract?: string;
  vault: string;
  nonce: number;
  expiry?: bigint;
  action: unknown;
}): string {
  const expiry = opts.expiry ?? BigInt(Date.now()) * 1_000_000n + 600_000_000_000n;
  return [
    "SANA-GUARD-ADMIN-v1",
    `network: ${opts.network ?? "near-testnet"}`,
    `contract: ${opts.contract ?? "guard.djume.testnet"}`,
    `vault: ${opts.vault}`,
    `nonce: ${opts.nonce}`,
    `expires: ${expiry}`,
    `action: ${JSON.stringify(opts.action)}`,
  ].join("\n");
}

class MockNear implements NearClient {
  balance = parseNearToYocto("5", "near").toString();
  nonce = 5;
  vault: VaultInfo | null = {
    owner: "",
    vault_address: "vault",
    path: "vault/x/0",
    agents: [],
    policy: {
      per_tx_limit: [],
      daily_cap: [],
      programs: [],
      max_priority_fee_lamports: "0",
      max_memo_len: 0,
      expires_at_ns: "0",
      loosen_delay_ns: "0",
    },
    paused: false,
  };
  submitted: Array<{ msg: string; sig: number[]; deposit: string; gas: string }> = [];
  result: NearTransaction = { txHash: "testhash", success: true };
  viewCalls = 0;

  async getBalance(): Promise<string> {
    this.viewCalls++;
    return this.balance;
  }
  async getOwnerNonce(_owner: string): Promise<number> {
    this.viewCalls++;
    return this.nonce;
  }
  async getVault(_id: number): Promise<VaultInfo | null> {
    this.viewCalls++;
    return this.vault;
  }
  async submitOwnerAction(
    msg: string,
    sig: number[],
    depositYocto: string,
    gasAmount: string
  ): Promise<NearTransaction> {
    this.submitted.push({ msg, sig, deposit: depositYocto, gas: gasAmount });
    return this.result;
  }
  async getTransactionStatus(_txHash: string): Promise<"success" | "failure" | "pending"> {
    return "pending";
  }
}

describe("checkInviteGate", () => {
  it("denies CreateVault when the gate is on and nothing is configured", () => {
    const check = checkInviteGate("CreateVault", "owner", undefined, testConfig({
      inviteToken: undefined,
      ownerAllowlist: undefined,
      adminGateEnabled: true,
    }));
    expect(check.allowed).toBe(false);
  });

  it("allows AddRecipient without a token", () => {
    const check = checkInviteGate("AddRecipient", "owner", undefined, testConfig());
    expect(check.allowed).toBe(true);
  });

  it("requires the invite token when set", () => {
    const cfg = testConfig({ inviteToken: "abc" });
    expect(checkInviteGate("AddAgent", "owner", "abc", cfg).allowed).toBe(true);
    expect(checkInviteGate("AddAgent", "owner", "wrong", cfg).allowed).toBe(false);
  });
});

describe("POST /v1/admin", () => {
  let db: RelayDatabase;
  let near: MockNear;
  let app: Hono;
  let keyPair: nacl.SignKeyPair;
  let owner: string;

  beforeEach(() => {
    db = new RelayDatabase("sqlite:./test-admin.db");
    near = new MockNear();
    keyPair = nacl.sign.keyPair();
    owner = bs58.encode(keyPair.publicKey);
    near.vault = { ...near.vault!, owner };
    app = new Hono();
    app.route("/", createAdminRouter(near, db, testConfig()));
    app.route("/", createQuoteRouter());
  });

  afterEach(async () => {
    db.close();
    await unlink("./test-admin.db").catch(() => {});
  });

  it("rejects a bad signature before any RPC", async () => {
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json", "x-invite-token": "secret-invite" },
      body: JSON.stringify({ msg, signature: Array.from(new Uint8Array(64)), owner }),
    });
    expect(res.status).toBe(401);
    expect(near.viewCalls).toBe(0);
  });

  it("rejects wrong network from the signed text", async () => {
    const msg = makeAdminMsg({
      network: "near-mainnet",
      vault: "0",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg, signature: signMsg(msg, keyPair.secretKey), owner }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid network");
    expect(near.viewCalls).toBe(0);
  });

  it("rejects wrong contract from the signed text", async () => {
    const msg = makeAdminMsg({
      contract: "other.testnet",
      vault: "0",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg, signature: signMsg(msg, keyPair.secretKey), owner }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid contract");
  });

  it("rejects an expired message", async () => {
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 6,
      expiry: 1n,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg, signature: signMsg(msg, keyPair.secretKey), owner }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Message expired");
  });

  it("rejects vault header mismatch locally", async () => {
    const msg = makeAdminMsg({
      vault: "7",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg, signature: signMsg(msg, keyPair.secretKey), owner }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Vault header mismatch");
    expect(near.viewCalls).toBe(0);
  });

  it("rejects unknown actions with 400", async () => {
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 6,
      action: { type: "NotARealAction", vault_id: 0 },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg, signature: signMsg(msg, keyPair.secretKey), owner }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 for a second in-flight (owner, nonce)", async () => {
    let release!: () => void;
    const blocker = new Promise<NearTransaction>((resolve) => {
      release = () => resolve({ txHash: "first", success: true });
    });
    near.submitOwnerAction = async (msg, sig, deposit, gas) => {
      near.submitted.push({ msg, sig, deposit, gas });
      return blocker;
    };

    const msg = makeAdminMsg({
      vault: "0",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const body = JSON.stringify({
      msg,
      signature: signMsg(msg, keyPair.secretKey),
      owner,
    });
    const first = app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    for (let i = 0; i < 50 && near.submitted.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(near.submitted.length).toBe(1);
    const second = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(second.status).toBe(409);
    release();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
  });

  it("passes the exact signed string through to owner_action", async () => {
    const action = { type: "AddRecipient", vault_id: 0, recipient: "café" };
    const msg = makeAdminMsg({ vault: "0", nonce: 6, action });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg,
        signature: signMsg(msg, keyPair.secretKey),
        owner,
      }),
    });
    expect(res.status).toBe(200);
    expect(near.submitted[0]?.msg).toBe(msg);
    expect(near.submitted[0]?.gas).toBe("100000000000000");
  });

  it("returns 503 when CreateVault would breach the balance floor", async () => {
    near.balance = parseNearToYocto("0.66", "near").toString();
    const action = {
      type: "CreateVault",
      owner,
      vault_address: owner,
      policy: {
        per_tx_limit: [["SOL", "1"]],
        daily_cap: [["SOL", "1"]],
        programs: ["11111111111111111111111111111111"],
        max_priority_fee_lamports: "0",
        max_memo_len: 0,
        expires_at_ns: "1",
        loosen_delay_ns: "1",
      },
    };
    const msg = makeAdminMsg({ vault: "null", nonce: 6, action });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-invite-token": "secret-invite",
      },
      body: JSON.stringify({ msg, signature: signMsg(msg, keyPair.secretKey) }),
    });
    expect(res.status).toBe(503);
    expect(near.submitted.length).toBe(0);
  });

  it("returns 403 for CreateVault without an invite token", async () => {
    const action = {
      type: "CreateVault",
      owner,
      vault_address: owner,
      policy: {
        per_tx_limit: [["SOL", "1"]],
        daily_cap: [["SOL", "1"]],
        programs: ["11111111111111111111111111111111"],
        max_priority_fee_lamports: "0",
        max_memo_len: 0,
        expires_at_ns: "1",
        loosen_delay_ns: "1",
      },
    };
    const msg = makeAdminMsg({ vault: "null", nonce: 6, action });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg, signature: signMsg(msg, keyPair.secretKey) }),
    });
    expect(res.status).toBe(403);
  });

  it("holds the reservation as unknown when submit times out with no hash", async () => {
    near.submitOwnerAction = async () => {
      throw new Error("Exceeded max retries for tx RPC timeout raw text");
    };
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg,
        signature: signMsg(msg, keyPair.secretKey),
        owner,
      }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Transaction status unknown; reservation held");
    expect(JSON.stringify(body)).not.toContain("RPC timeout");
    expect(db.checkNonceInFlight(owner, 6)).toBe(true);
    expect(db.listUnknownReservations()).toHaveLength(1);
  });

  it("does not return raw RPC error text in a 500", async () => {
    near.getVault = async () => {
      throw new Error("SERVER_ERROR: raw rpc dump {\"code\":-32000}");
    };
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg,
        signature: signMsg(msg, keyPair.secretKey),
        owner,
      }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("SERVER_ERROR");
    expect(JSON.stringify(body)).not.toContain("raw rpc");
  });

  it("returns the tx hash and error on an on-chain failure", async () => {
    near.result = {
      txHash: "failhash",
      success: false,
      errorMessage: "SG_E074_PROGRAM_NOT_ALLOWED",
    };
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 6,
      action: { type: "AddRecipient", vault_id: 0, recipient: owner },
    });
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg,
        signature: signMsg(msg, keyPair.secretKey),
        owner,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.txHash).toBe("failhash");
    expect(body.error).toBe("SG_E074_PROGRAM_NOT_ALLOWED");
  });
});

describe("GET /v1/quote", () => {
  const app = new Hono();
  app.route("/", createQuoteRouter());

  it("quotes CreateVault as exact 0.5 NEAR yocto", async () => {
    const res = await app.request("/v1/quote/CreateVault");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.depositYocto).toBe(CREATE_VAULT_DEPOSIT.toString());
  });

  it("quotes AddAgent 0.15 as the same yocto submit uses", async () => {
    const res = await app.request("/v1/quote/AddAgent?gas_funding=0.15");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.depositYocto).toBe("200000000000000000000000");
  });

  it("rejects AddAgent funding below 0.15 and above 0.5", async () => {
    expect((await app.request("/v1/quote/AddAgent?gas_funding=0.10")).status).toBe(400);
    expect((await app.request("/v1/quote/AddAgent?gas_funding=0.6")).status).toBe(400);
  });

  it("quotes BackfillRecipients as 0", async () => {
    const res = await app.request("/v1/quote/BackfillRecipients");
    expect(res.status).toBe(200);
    expect((await res.json()).depositYocto).toBe("0");
  });

  it("returns 400 for an unknown action", async () => {
    const res = await app.request("/v1/quote/NoSuchThing");
    expect(res.status).toBe(400);
  });
});
