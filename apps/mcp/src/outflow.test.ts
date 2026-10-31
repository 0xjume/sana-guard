import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  SystemProgram,
} from "@solana/web3.js";
import { createTransferInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import {
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  buildSolTransfer,
  buildTokenTransfer,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
} from "@sana-guard/sdk";
import { describe, expect, it } from "vitest";
import { SERVER_MAX_CODE } from "./errors.js";
import { accountVaultOutflow, checkSignMessage } from "./outflow.js";
import type { VaultView } from "@sana-guard/sdk";

const vaultAddress = new PublicKey("Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU");
const recipient = new PublicKey("DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB");
const blockhash = "Ht6GqHqTWjgDKVVALPWnR1qXaP8Qm7u2abYcGvMxLbGN";
const mint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function vault(overrides: Partial<VaultView> = {}): VaultView {
  return {
    owner: "owner",
    vaultAddress: vaultAddress.toBase58(),
    path: "vault/x/0",
    agents: ["agent1.guard.djume.testnet"],
    policy: {
      perTxLimit: [
        { mint: { type: "sol" }, amount: 50_000_000n },
        { mint: { type: "spl", address: mint }, amount: 1_000_000n },
      ],
      dailyCap: [
        { mint: { type: "sol" }, amount: 100_000_000n },
        { mint: { type: "spl", address: mint }, amount: 5_000_000n },
      ],
      programs: [SYSTEM_PROGRAM.toBase58(), TOKEN_PROGRAM.toBase58()],
      maxPriorityFeeLamports: 100_000n,
      maxMemoLen: 64,
      expiresAtNs: 9_000_000_000_000_000_000n,
      loosenDelayNs: 1n,
    },
    paused: false,
    state: "Active",
    ...overrides,
  };
}

describe("accountVaultOutflow", () => {
  it("sums SOL system-transfer outflow from the vault", () => {
    const message = buildSolTransfer(vaultAddress, recipient, 20_000n, blockhash, { version: "v0" });
    const result = accountVaultOutflow(message, vaultAddress);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.spend).toEqual([{ mint: "SOL", amount: 20_000n }]);
    expect(result.transfers[0]).toMatchObject({
      kind: "sol",
      to: recipient.toBase58(),
      amount: 20_000n,
    });
  });

  it("sums SPL transferChecked amounts per mint", async () => {
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const fromAta = await getAssociatedTokenAddress(mint, vaultAddress);
    const toAta = await getAssociatedTokenAddress(mint, recipient);
    const message = buildTokenTransfer(
      vaultAddress,
      recipient,
      mint,
      250n,
      6,
      fromAta,
      toAta,
      blockhash,
      { version: "v0", createAta: false }
    );
    const result = accountVaultOutflow(message, vaultAddress);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.spend).toEqual([{ mint: mint.toBase58(), amount: 250n }]);
    expect(result.transfers[0]?.to).toBe(toAta.toBase58());
  });

  it("rejects an unknown program that could move funds", () => {
    const ix = new TransactionInstruction({
      keys: [{ pubkey: vaultAddress, isSigner: true, isWritable: true }],
      programId: new PublicKey("Vote111111111111111111111111111111111111111"),
      data: Buffer.from([1]),
    });
    const message = new TransactionMessage({
      payerKey: vaultAddress,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const bytes = message.serialize();
    const result = accountVaultOutflow(bytes, vaultAddress);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("SG_E018_UNKNOWN_PROGRAM");
  });

  it("rejects unchecked SPL transfer as unaccountable (no mint in the ix)", async () => {
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const fromAta = await getAssociatedTokenAddress(mint, vaultAddress);
    const toAta = await getAssociatedTokenAddress(mint, recipient);
    const ix = createTransferInstruction(fromAta, toAta, vaultAddress, 99n);
    const compiled = new TransactionMessage({
      payerKey: vaultAddress,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const result = accountVaultOutflow(compiled.serialize(), vaultAddress);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("SG_E043_MINT_UNKNOWN");
  });

  it("rejects unsupported System instructions", () => {
    const ix = SystemProgram.createAccount({
      fromPubkey: vaultAddress,
      newAccountPubkey: recipient,
      lamports: 1_000_000,
      space: 0,
      programId: SYSTEM_PROGRAM,
    });
    const compiled = new TransactionMessage({
      payerKey: vaultAddress,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const result = accountVaultOutflow(compiled.serialize(), vaultAddress);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("SG_E022_SYSTEM_UNSUPPORTED");
  });

  it("accounts transferChecked the same as the contract (source, mint, dest, authority)", async () => {
    const { getAssociatedTokenAddress } = await import("@solana/spl-token");
    const fromAta = await getAssociatedTokenAddress(mint, vaultAddress);
    const toAta = await getAssociatedTokenAddress(mint, recipient);
    const ix = createTransferCheckedInstruction(fromAta, mint, toAta, vaultAddress, 7n, 6);
    const compiled = new TransactionMessage({
      payerKey: vaultAddress,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const result = accountVaultOutflow(compiled.serialize(), vaultAddress);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.spend[0]).toEqual({ mint: mint.toBase58(), amount: 7n });
  });

  it("accepts an SDK memo (Memo v1, same as the guard constant)", () => {
    expect(MEMO_PROGRAM.toBase58()).toBe("Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo");
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, {
      version: "v0",
      memo: "payout",
    });
    const result = accountVaultOutflow(message, vaultAddress);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.programs).toContain(MEMO_PROGRAM.toBase58());
    expect(result.memos).toEqual(["payout"]);
  });

  it("rejects the real Memo v2 program as unaccountable", () => {
    const memoV2 = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const ix = new TransactionInstruction({
      keys: [],
      programId: memoV2,
      data: Buffer.from("payout"),
    });
    const compiled = new TransactionMessage({
      payerKey: vaultAddress,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message();
    const result = accountVaultOutflow(compiled.serialize(), vaultAddress);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("SG_E018_UNKNOWN_PROGRAM");
  });
});

describe("checkSignMessage", () => {
  it("applies max-per-call to decoded SOL outflow (the sign_transaction bypass)", async () => {
    const message = buildSolTransfer(vaultAddress, recipient, 20_000n, blockhash, { version: "v0" });
    const result = await checkSignMessage({
      message,
      vaultAddress,
      vault: vault(),
      recipients: [recipient.toBase58()],
      spend24h: [],
      nowNs: 1n,
      maxLamportsPerCall: 10_000n,
    });
    expect(result.wouldPass).toBe(false);
    expect(result.reasons.map((row) => row.code)).toContain(SERVER_MAX_CODE);
  });

  it("passes a transfer inside the server max and policy", async () => {
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, { version: "v0" });
    const result = await checkSignMessage({
      message,
      vaultAddress,
      vault: vault(),
      recipients: [recipient.toBase58()],
      spend24h: [],
      nowNs: 1n,
      maxLamportsPerCall: 10_000n,
    });
    expect(result.wouldPass).toBe(true);
    expect(result.spend?.[0]?.amount).toBe("1000");
  });

  it("refuses a memo when Memo v1 is not on the vault program allowlist (SG_E074)", async () => {
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, {
      version: "v0",
      memo: "payout",
    });
    const result = await checkSignMessage({
      message,
      vaultAddress,
      vault: vault(),
      recipients: [recipient.toBase58()],
      spend24h: [],
      nowNs: 1n,
    });
    expect(result.wouldPass).toBe(false);
    expect(result.reasons.map((row) => row.code)).toContain("SG_E074_PROGRAM_NOT_ALLOWED");
  });

  it("refuses a memo longer than policy maxMemoLen (SG_E073)", async () => {
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, {
      version: "v0",
      memo: "this-memo-is-way-too-long",
      maxMemoLen: 65535,
    });
    const result = await checkSignMessage({
      message,
      vaultAddress,
      vault: vault({
        policy: {
          ...vault().policy,
          programs: [SYSTEM_PROGRAM.toBase58(), MEMO_PROGRAM.toBase58()],
          maxMemoLen: 8,
        },
      }),
      recipients: [recipient.toBase58()],
      spend24h: [],
      nowNs: 1n,
    });
    expect(result.wouldPass).toBe(false);
    expect(result.reasons.map((row) => row.code)).toContain("SG_E073_MEMO_TOO_LONG");
  });

  it("passes a short memo when Memo v1 is allowlisted", async () => {
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, {
      version: "v0",
      memo: "ok",
    });
    const result = await checkSignMessage({
      message,
      vaultAddress,
      vault: vault({
        policy: {
          ...vault().policy,
          programs: [SYSTEM_PROGRAM.toBase58(), MEMO_PROGRAM.toBase58()],
        },
      }),
      recipients: [recipient.toBase58()],
      spend24h: [],
      nowNs: 1n,
    });
    expect(result.wouldPass).toBe(true);
  });
});

describe("priority fee accounting (matches contract priority_fee_lamports)", () => {
  it("charges a price without a limit on the default limit", () => {
    // 2 instructions -> 400_000 default CU x 1_000_000 micro-lamports = 400_000 lamports
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, {
      version: "v0",
      computeUnitPrice: 1_000_000n,
    });
    const result = accountVaultOutflow(message, vaultAddress);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.priorityFee).toBe(400_000n);
    expect(result.spend).toEqual([{ mint: "SOL", amount: 1_000n + 400_000n + 5_000n }]);
  });

  it("uses an explicit limit when present", () => {
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, {
      version: "v0",
      computeUnitLimit: 10_000,
      computeUnitPrice: 1_000_000n,
    });
    const result = accountVaultOutflow(message, vaultAddress);
    expect(result.ok && result.priorityFee).toBe(10_000n);
  });

  it("rejects a total priority fee over the policy max (SG_E078)", async () => {
    const message = buildSolTransfer(vaultAddress, recipient, 1_000n, blockhash, {
      version: "v0",
      computeUnitPrice: 1_000_000n,
    });
    const base = vault();
    const result = await checkSignMessage({
      message,
      vaultAddress,
      vault: {
        ...base,
        policy: {
          ...base.policy,
          programs: [...base.policy.programs, COMPUTE_BUDGET_PROGRAM.toBase58()],
          maxTotalPriorityFeeLamports: 100_000n,
        },
      },
      recipients: [recipient.toBase58()],
      spend24h: [],
      nowNs: 1n,
    });
    expect(result.wouldPass).toBe(false);
    expect(result.reasons.map((row) => row.code)).toContain("SG_E078_PRIORITY_FEE_TOTAL_TOO_HIGH");
  });
});
