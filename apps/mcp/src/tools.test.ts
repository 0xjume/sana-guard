import { PublicKey } from "@solana/web3.js";
import { SYSTEM_PROGRAM, SanaGuardSignError, type VaultView } from "@sana-guard/sdk";
import { describe, expect, it, vi } from "vitest";
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
        explorer: "https://explorer.solana.com/tx/SoLsig111?cluster=devnet",
        status: "confirmed",
      })),
    },
    solana: {
      getBalance: vi.fn(async () => 42n),
      getTokenBalance: vi.fn(async () => 0n),
      getLatestBlockhash: vi.fn(async () => ({
        blockhash: "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN",
        lastValidBlockHeight: 99,
      })),
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
});
