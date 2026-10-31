import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SYSTEM_PROGRAM, SanaGuardSignError, buildSolTransfer, type VaultView } from "@sana-guard/sdk";
import { describe, expect, it, vi } from "vitest";
import { BLOCKHASH_EXPIRED_CODE, KEY_REUSED_CODE, SERVER_MAX_CODE } from "./errors.js";
import type { GuardRuntime } from "./runtime.js";
import { createToolHandlers, generateIdempotencyKey } from "./tools.js";

const recipient = "DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB";
const vaultAddress = new PublicKey("Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU");

function vault(): VaultView {
  return {
    owner: "owner",
    vaultAddress: vaultAddress.toBase58(),
    path: "vault/x/0",
    agents: ["agent1.guard.djume.testnet"],
    policy: {
      perTxLimit: [{ mint: { type: "sol" }, amount: 50_000_000n }],
      dailyCap: [{ mint: { type: "sol" }, amount: 100_000_000n }],
      programs: [SYSTEM_PROGRAM.toBase58()],
      maxPriorityFeeLamports: 100_000n,
      maxMemoLen: 64,
      expiresAtNs: 9_000_000_000_000_000_000n,
      loosenDelayNs: 1n,
    },
    paused: false,
    state: "Active",
  };
}

function runtime(overrides: Partial<GuardRuntime> = {}): GuardRuntime {
  return {
    config: {
      nearNetwork: "testnet",
      nearRpcUrl: "https://rpc.testnet.near.org",
      guardContractId: "guard.djume.testnet",
      agentAccountId: "agent1.guard.djume.testnet",
      agentPrivateKey: "secret-must-never-leak",
      vaultId: 0,
      mpcContract: "v1.signer-prod.testnet",
      mpcDomainId: 1,
      solanaRpcUrl: "https://api.devnet.solana.com",
      allowMainnet: false,
      transport: "stdio",
      httpHost: "127.0.0.1",
      httpPort: 8787,
      httpAllowPublic: false,
      httpAllowedHosts: ["localhost", "127.0.0.1", "[::1]", "::1"],
      httpMaxSessions: 32,
      httpSessionTtlMs: 1_800_000,
    },
    publicConfig: {
      nearNetwork: "testnet",
      nearRpcUrl: "https://rpc.testnet.near.org",
      guardContractId: "guard.djume.testnet",
      agentAccountId: "agent1.guard.djume.testnet",
      vaultId: 0,
      solanaRpcUrl: "https://api.devnet.solana.com",
      solanaCluster: "devnet",
      allowMainnet: false,
      transport: "stdio",
    },
    views: {
      getVault: vi.fn(async () => vault()),
      getSpend24h: vi.fn(async () => [{ mint: "SOL", amount: 1_000_000n }]),
      getRecipients: vi.fn(async () => [recipient]),
      getRequest: vi.fn(async () => null),
    },
    client: {
      requestSignAndBroadcast: vi.fn(async () => ({
        signature: "SoLsig111",
        explorer: "https://explorer.solana.com/tx/SoLsig111?cluster=mainnet-beta",
        status: "confirmed",
        nearTxHash: "NEAR_TX_HASH",
      })),
    },
    solana: {
      getBalance: vi.fn(async () => 42n),
      getTokenBalance: vi.fn(async () => 0n),
      getLatestBlockhash: vi.fn(async () => ({
        blockhash: "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN",
        lastValidBlockHeight: 99,
      })),
      isBlockhashValid: vi.fn(async () => true),
      getMintDecimals: vi.fn(async () => 6),
      getBlockHeight: vi.fn(async () => 10),
    },
    vaultAddress,
    nowNs: () => 1n,
    ...overrides,
  };
}

function parse(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content[0];
  if (!text || text.type !== "text" || !text.text) {
    throw new Error("expected text content");
  }
  return JSON.parse(text.text) as Record<string, unknown>;
}

describe("tool handlers", () => {
  it("status never includes the private key", async () => {
    const handlers = createToolHandlers(runtime());
    const body = parse(await handlers.status());
    expect(body.ok).toBe(true);
    expect(body.agentAccount).toBe("agent1.guard.djume.testnet");
    expect(JSON.stringify(body)).not.toContain("secret-must-never-leak");
    expect(body.killSwitch).toBe(false);
    expect((body.balances as { solLamports: string }).solLamports).toBe("42");
  });

  it("get_policy reports remaining 24h as strings", async () => {
    const handlers = createToolHandlers(runtime());
    const body = parse(await handlers.getPolicy());
    const rolling = body.rolling24h as Array<{ remaining24h: string; spent24h: string }>;
    expect(rolling[0]?.spent24h).toBe("1000000");
    expect(rolling[0]?.remaining24h).toBe("99000000");
  });

  it("check_transfer is a dry-run and does not call requestSignAndBroadcast", async () => {
    const rt = runtime();
    const handlers = createToolHandlers(rt);
    const result = await handlers.checkTransfer({ kind: "sol", to: recipient, amount: "1000" });
    expect(result.isError).toBeUndefined();
    expect(rt.client.requestSignAndBroadcast).not.toHaveBeenCalled();
    expect(parse(result).wouldPass).toBe(true);
  });

  it("transfer_sol returns requestId, signature, explorer, status", async () => {
    const rt = runtime();
    const key = generateIdempotencyKey();
    const handlers = createToolHandlers(rt);
    const body = parse(await handlers.transferSol({ to: recipient, amount: "1000", idempotencyKey: key }));
    expect(body.requestId).toBe(key);
    expect(body.signature).toBe("SoLsig111");
    expect(body.explorer).toContain("explorer.solana.com");
    expect(body.status).toBe("confirmed");
    expect(body.nearTxHash).toBe("NEAR_TX_HASH");
    expect(body.explorer).toBe("https://explorer.solana.com/tx/SoLsig111?cluster=devnet");
    expect(body.explorer).not.toContain("mainnet-beta");
    expect(rt.client.requestSignAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: key, lastValidBlockHeight: 99 })
    );
  });

  it("transfer_sol generates a 64-hex key when omitted", async () => {
    const handlers = createToolHandlers(runtime());
    const body = parse(await handlers.transferSol({ to: recipient, amount: "1000" }));
    expect(body.requestId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("maps SanaGuardSignError onto a structured error with requestId", async () => {
    const requestId = generateIdempotencyKey();
    const rt = runtime({
      client: {
        requestSignAndBroadcast: vi.fn(async () => {
          throw new SanaGuardSignError("Per-transaction limit exceeded for mint", requestId, "SG_E062_PER_TX_LIMIT_EXCEEDED");
        }),
      },
    });
    const handlers = createToolHandlers(rt);
    const result = await handlers.transferSol({ to: recipient, amount: "1000", idempotencyKey: requestId });
    expect(result.isError).toBe(true);
    const body = parse(result);
    expect(body.code).toBe("SG_E062_PER_TX_LIMIT_EXCEEDED");
    expect(body.requestId).toBe(requestId);
    expect(body.why).toMatch(/Do not retry/);
  });

  it("get_request returns not-found without leaking keys", async () => {
    const handlers = createToolHandlers(runtime());
    const id = generateIdempotencyKey();
    const body = parse(await handlers.getRequest({ requestId: id }));
    expect(body.found).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secret-must-never-leak");
  });

  it("sign_transaction refuses outflow above max-per-call and does not sign", async () => {
    const rt = runtime({
      config: {
        ...runtime().config,
        maxLamportsPerCall: 10_000n,
      },
    });
    const message = buildSolTransfer(
      vaultAddress,
      new PublicKey(recipient),
      20_000n,
      "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN",
      { version: "v0" }
    );
    const handlers = createToolHandlers(rt);
    const result = await handlers.signTransaction({
      transactionBase64: Buffer.from(message).toString("base64"),
    });
    expect(result.isError).toBe(true);
    expect(parse(result).reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: SERVER_MAX_CODE })])
    );
    expect(rt.client.requestSignAndBroadcast).not.toHaveBeenCalled();
  });

  it("sign_transaction uses getLatestBlockhash lastValidBlockHeight, not getBlockHeight+150", async () => {
    const rt = runtime();
    const message = buildSolTransfer(
      vaultAddress,
      new PublicKey(recipient),
      1_000n,
      "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN",
      { version: "v0" }
    );
    const handlers = createToolHandlers(rt);
    await handlers.signTransaction({
      transactionBase64: Buffer.from(message).toString("base64"),
    });
    expect(rt.solana.getLatestBlockhash).toHaveBeenCalled();
    expect(rt.client.requestSignAndBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ lastValidBlockHeight: 99 })
    );
    expect(rt.solana.getBlockHeight).not.toHaveBeenCalled();
  });

  it("returns the original request for a repeated idempotencyKey without submitting", async () => {
    const key = generateIdempotencyKey();
    const rt = runtime({
      views: {
        getVault: vi.fn(async () => vault()),
        getSpend24h: vi.fn(async () => []),
        getRecipients: vi.fn(async () => [recipient]),
        getRequest: vi.fn(async () => ({
          vaultId: 0,
          agent: "agent1.guard.djume.testnet",
          msgHash: "aa",
          spend: [{ mint: "SOL", amount: 1000n }],
          hour: 1,
          status: { status: "Signed" as const },
          signature: "already-signed",
          createdNs: 1n,
        })),
      },
    });
    const handlers = createToolHandlers(rt);
    const body = parse(await handlers.transferSol({ to: recipient, amount: "1000", idempotencyKey: key }));
    expect(body.alreadyExists).toBe(true);
    expect(body.code).toBe("SG_E059_DUPLICATE_REQ_ID");
    expect(body.signature).toBe("already-signed");
    expect(rt.client.requestSignAndBroadcast).not.toHaveBeenCalled();
  });

  it("keeps an auto-generated idempotencyKey when broadcast throws a plain Error", async () => {
    const rt = runtime({
      client: {
        requestSignAndBroadcast: vi.fn(async () => {
          throw new Error("sendRawTransaction failed");
        }),
      },
    });
    const handlers = createToolHandlers(rt);
    const result = await handlers.transferSol({ to: recipient, amount: "1000" });
    expect(result.isError).toBe(true);
    const body = parse(result);
    expect(body.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(body.requestId).toBe(body.idempotencyKey);
  });

  it("keeps idempotencyKey, requestId, and nearTxHash when broadcast fails after signing", async () => {
    const requestId = generateIdempotencyKey();
    const rt = runtime({
      client: {
        requestSignAndBroadcast: vi.fn(async () => {
          throw new SanaGuardSignError("blockhash expired", requestId, undefined, "NEAR_AFTER_SIGN");
        }),
      },
    });
    const handlers = createToolHandlers(rt);
    const result = await handlers.transferSol({ to: recipient, amount: "1000", idempotencyKey: requestId });
    expect(result.isError).toBe(true);
    const body = parse(result);
    expect(body.idempotencyKey).toBe(requestId);
    expect(body.requestId).toBe(requestId);
    expect(body.nearTxHash).toBe("NEAR_AFTER_SIGN");
  });

  it("get_policy exposes remaining 24h under remaining and rolling24h", async () => {
    const handlers = createToolHandlers(runtime());
    const body = parse(await handlers.getPolicy());
    expect(body.remaining).toEqual(body.rolling24h);
    expect((body.remaining as Array<{ remaining24h: string }>)[0]?.remaining24h).toBe("99000000");
  });

  it("refuses a repeated idempotencyKey reused for a different transfer", async () => {
    const rt = runtime({
      views: {
        getVault: vi.fn(async () => vault()),
        getSpend24h: vi.fn(async () => []),
        getRecipients: vi.fn(async () => [recipient]),
        getRequest: vi.fn(async () => ({
          vaultId: 0,
          agent: "agent1.guard.djume.testnet",
          msgHash: "aa",
          spend: [{ mint: "SOL", amount: 1n }],
          hour: 1,
          status: { status: "Signed" as const },
          signature: "already-signed",
          createdNs: 1n,
        })),
      },
    });
    const handlers = createToolHandlers(rt);
    const result = await handlers.transferSol({
      to: recipient,
      amount: "1000",
      idempotencyKey: generateIdempotencyKey(),
    });
    const body = parse(result);
    expect(result.isError).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.code).toBe(KEY_REUSED_CODE);
    expect(body.alreadyExists).toBeUndefined();
    expect(rt.client.requestSignAndBroadcast).not.toHaveBeenCalled();
  });

  it("sign_transaction treats a repeated key as a retry only when the message hash matches", async () => {
    const message = buildSolTransfer(
      vaultAddress,
      new PublicKey(recipient),
      1_000n,
      "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN",
      { version: "v0" }
    );
    const storedHash = bs58.encode(createHash("sha256").update(message).digest());
    const request = (msgHash: string) => ({
      vaultId: 0,
      agent: "agent1.guard.djume.testnet",
      msgHash,
      spend: [{ mint: "SOL", amount: 1_000n }],
      hour: 1,
      status: { status: "Signed" as const },
      signature: "already-signed",
      createdNs: 1n,
    });
    const transactionBase64 = Buffer.from(message).toString("base64");
    const idempotencyKey = generateIdempotencyKey();

    const same = runtime();
    vi.mocked(same.views.getRequest).mockResolvedValue(request(storedHash));
    const retry = parse(
      await createToolHandlers(same).signTransaction({ transactionBase64, idempotencyKey })
    );
    expect(retry.alreadyExists).toBe(true);

    const other = runtime();
    vi.mocked(other.views.getRequest).mockResolvedValue(request("different-hash"));
    const reused = parse(
      await createToolHandlers(other).signTransaction({ transactionBase64, idempotencyKey })
    );
    expect(reused.code).toBe(KEY_REUSED_CODE);
    expect(other.client.requestSignAndBroadcast).not.toHaveBeenCalled();
  });

  it("sign_transaction refuses an expired blockhash before signing", async () => {
    const rt = runtime();
    vi.mocked(rt.solana.isBlockhashValid).mockResolvedValue(false);
    const message = buildSolTransfer(
      vaultAddress,
      new PublicKey(recipient),
      1_000n,
      "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN",
      { version: "v0" }
    );
    const result = await createToolHandlers(rt).signTransaction({
      transactionBase64: Buffer.from(message).toString("base64"),
    });
    expect(result.isError).toBe(true);
    expect(parse(result).code).toBe(BLOCKHASH_EXPIRED_CODE);
    expect(rt.client.requestSignAndBroadcast).not.toHaveBeenCalled();
  });
});
