import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { unlink } from "fs/promises";
import { createAdminRouter, checkInviteGate } from "./routes/admin.js";
import { createQuoteRouter } from "./routes/quote.js";
import { RelayDatabase } from "./db.js";
import type { Config } from "./config.js";
import type { NearClient, NearTransaction, SubmitHooks, TxStatusResult, VaultInfo } from "./near/interface.js";
import { PreSignError } from "./near/errors.js";
import { CREATE_VAULT_DEPOSIT, parseNearToYocto } from "./constants.js";
import { createVaultDerivationPath } from "./validation.js";

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    relayAccountId: "relay.test.near",
    relayPrivateKey: "ed25519:test",
    nearNetwork: "testnet",
    nearRpcUrl: "http://localhost",
    guardContractId: "guard.djume.testnet",
    databaseUrl: "sqlite:./test-admin.db",
    relayBalanceFloorYocto: parseNearToYocto("0.5", "near"),
    maxAgentGasFundingYocto: parseNearToYocto("0.5", "near"),
    globalDailyBudgetYocto: parseNearToYocto("1.0", "near"),
    maxDepositPerCallYocto: parseNearToYocto("2.0", "near"),
    ownerRateLimitPerHour: 30,
    ownerDailyBudgetYocto: parseNearToYocto("5.0", "near"),
    port: 3000,
    nodeEnv: "test",
    logLevel: "error",
    inviteToken: "secret-invite",
    ownerAllowlist: undefined,
    corsOrigins: undefined,
    adminGateEnabled: true,
    trustProxy: false,
    trustProxyHops: 1,
    rateLimitIpv6Prefix: 64,
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
  ownerVaultCount = 0;
  derivedPublicKey = "";
  derivedPaths: string[] = [];

  async getBalance(): Promise<string> {
    this.viewCalls++;
    return this.balance;
  }
  async getOwnerNonce(_owner: string): Promise<number> {
    this.viewCalls++;
    return this.nonce;
  }
  async getOwnerVaultCount(_owner: string): Promise<number> {
    this.viewCalls++;
    return this.ownerVaultCount;
  }
  async getDerivedPublicKey(path: string, _predecessor: string): Promise<string> {
    this.viewCalls++;
    this.derivedPaths.push(path);
    return this.derivedPublicKey;
  }
  async getVault(_id: number): Promise<VaultInfo | null> {
    this.viewCalls++;
    return this.vault;
  }
  async submitOwnerAction(
    msg: string,
    sig: number[],
    depositYocto: string,
    gasAmount: string,
    hooks?: SubmitHooks
  ): Promise<NearTransaction> {
    hooks?.onSigned?.(this.result.txHash);
    this.submitted.push({ msg, sig, deposit: depositYocto, gas: gasAmount });
    return this.result;
  }
  async getTransactionStatus(_txHash: string): Promise<TxStatusResult> {
    return { status: "pending" };
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
    near.derivedPublicKey = `ed25519:${owner}`;
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

  it("returns 400 INVALID_JSON for a malformed body", async () => {
    const res = await app.request("/v1/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_JSON");
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 500 for an unexpected error after a valid JSON body", async () => {
    near.getVault = async () => {
      throw new Error("Unexpected token in JSON at position 0");
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
    expect(body.code).toBeUndefined();
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

  it("rejects CreateVault when MPC derived key does not match vault_address", async () => {
    const otherKey = nacl.sign.keyPair();
    near.derivedPublicKey = `ed25519:${bs58.encode(otherKey.publicKey)}`;
    near.ownerVaultCount = 2;
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
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VAULT_ADDRESS_MISMATCH");
    expect(near.submitted.length).toBe(0);
    expect(near.derivedPaths).toEqual([createVaultDerivationPath(owner, 2)]);
    expect(db.checkNonceInFlight(owner, 6)).toBe(false);
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

  it("holds the reservation as unknown when submit times out with a hash", async () => {
    near.submitOwnerAction = async (_m, _s, _d, _g, hooks) => {
      hooks?.onSigned?.("timeout-hash");
      const err = new Error("Exceeded the maximum number of retries") as Error & {
        transaction: { hash: string };
      };
      err.transaction = { hash: "timeout-hash" };
      throw err;
    };
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 7,
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
    const unknown = db.listUnknownReservations();
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.txHash).toBe("timeout-hash");
    expect(db.checkNonceInFlight(owner, 7)).toBe(true);

    const resolved = await db.resolveUnknownReservations({
      checkTx: async (hash) => {
        expect(hash).toBe("timeout-hash");
        return { status: "failure", tokensBurntYocto: "0" };
      },
      checkOwnerNonce: async () => 0,
      nowMs: Date.now(),
      txValidityMs: 24 * 60 * 60 * 1000,
    });
    expect(resolved).toBe(1);
    expect(db.checkNonceInFlight(owner, 7)).toBe(false);
  });

  it("persists the signed hash before broadcast even when send throws without one", async () => {
    near.submitOwnerAction = async (_m, _s, _d, _g, hooks) => {
      hooks?.onSigned?.("signed-before-send");
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
    const unknown = db.listUnknownReservations();
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.txHash).toBe("signed-before-send");
  });

  it("releases the reservation immediately on a PreSignError", async () => {
    near.submitOwnerAction = async () => {
      throw new PreSignError("Failed to fetch latest block");
    };
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 9,
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
    expect((await res.json()).code).toBe("PRE_SIGN_FAILED");
    expect(db.checkNonceInFlight(owner, 9)).toBe(false);
    expect(db.listUnknownReservations()).toHaveLength(0);
    expect(db.getGlobalStats(Date.now()).spentToday).toBe("0");
  });

  it("re-reads relay balance inside the lock for the floor check", async () => {
    const order: string[] = [];
    near.getVault = async () => {
      order.push("vault");
      return near.vault;
    };
    near.getOwnerNonce = async () => {
      order.push("nonce");
      return near.nonce;
    };
    near.getBalance = async () => {
      order.push("balance");
      return parseNearToYocto("0.55", "near").toString();
    };
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 10,
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
    expect(order).toEqual(["vault", "nonce", "balance"]);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("BALANCE_TOO_LOW");
    expect(near.submitted).toHaveLength(0);
  });

  it("releases the reservation on InvalidNonce before acceptance", async () => {
    near.submitOwnerAction = async (_m, _s, _d, _g, hooks) => {
      hooks?.onSigned?.("rejected-hash");
      const err = new Error("InvalidNonce: expired") as Error & { type: string };
      err.type = "InvalidNonce";
      throw err;
    };
    const msg = makeAdminMsg({
      vault: "0",
      nonce: 8,
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
    expect((await res.json()).code).toBe("TX_REJECTED");
    expect(db.checkNonceInFlight(owner, 8)).toBe(false);
    expect(db.getGlobalStats(Date.now()).spentToday).toBe("0");
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
