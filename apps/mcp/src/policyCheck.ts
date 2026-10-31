import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, type Mint, type Policy, type VaultView } from "@sana-guard/sdk";
import { SERVER_MAX_CODE } from "./errors.js";

export type TransferKind = "sol" | "spl";

export interface CheckTransferInput {
  kind: TransferKind;
  to: string;
  amount: bigint;
  mint?: string;
}

export interface CheckReason {
  code: string;
  message: string;
}

export interface CheckTransferResult {
  ok: boolean;
  wouldPass: boolean;
  reasons: CheckReason[];
  amount: string;
  mint: string;
  recipientChecked: string;
  perTxLimit?: string;
  dailyCap?: string;
  spent24h?: string;
  remaining24h?: string;
}

function mintKey(mint: Mint): string {
  return mint.type === "sol" ? "SOL" : mint.address.toBase58();
}

export function normalizeSpendMint(raw: string): string {
  return raw === "Sol" || raw === "SOL" ? "SOL" : raw;
}

function findLimit(policy: Policy, key: string, which: "perTxLimit" | "dailyCap") {
  return policy[which].find((row) => mintKey(row.mint) === key);
}

function spentFor(spend: Array<{ mint: string; amount: bigint }>, key: string): bigint {
  return spend
    .filter((row) => normalizeSpendMint(row.mint) === key)
    .reduce((sum, row) => sum + row.amount, 0n);
}

export async function resolveRecipient(input: CheckTransferInput): Promise<string> {
  if (input.kind === "sol") {
    return input.to;
  }
  if (!input.mint) {
    throw new Error("mint is required for SPL transfers");
  }
  const ata = await getAssociatedTokenAddress(new PublicKey(input.mint), new PublicKey(input.to));
  return ata.toBase58();
}

export async function checkTransfer(opts: {
  vault: VaultView | null;
  recipients: string[];
  spend24h: Array<{ mint: string; amount: bigint }>;
  input: CheckTransferInput;
  nowNs: bigint;
  maxLamportsPerCall?: bigint;
  maxTokenAmountPerCall?: bigint;
}): Promise<CheckTransferResult> {
  const { vault, recipients, spend24h, input, nowNs, maxLamportsPerCall, maxTokenAmountPerCall } = opts;
  const reasons: CheckReason[] = [];
  const mint = input.kind === "sol" ? "SOL" : input.mint ?? "";
  let recipientChecked = input.to;

  if (!vault) {
    reasons.push({ code: "SG_E054_VAULT_NOT_FOUND", message: "Vault not found" });
    return {
      ok: false,
      wouldPass: false,
      reasons,
      amount: input.amount.toString(),
      mint,
      recipientChecked,
    };
  }

  if (vault.state !== "Active") {
    reasons.push({ code: "SG_E076_VAULT_NOT_ACTIVE", message: `Vault state is ${vault.state}` });
  }
  if (vault.paused) {
    reasons.push({ code: "SG_E055_VAULT_PAUSED", message: "Vault kill switch is on" });
  }
  if (nowNs >= vault.policy.expiresAtNs) {
    reasons.push({ code: "SG_E057_POLICY_EXPIRED", message: "Policy has expired" });
  }

  const neededProgram = input.kind === "sol" ? SYSTEM_PROGRAM.toBase58() : TOKEN_PROGRAM.toBase58();
  if (!vault.policy.programs.includes(neededProgram)) {
    reasons.push({
      code: "SG_E074_PROGRAM_NOT_ALLOWED",
      message: `Program ${neededProgram} is not in the vault program allowlist`,
    });
  }

  try {
    recipientChecked = await resolveRecipient(input);
  } catch (error) {
    reasons.push({
      code: input.kind === "sol" ? "SG_E067_RECIPIENT_NOT_ALLOWED" : "SG_E068_RECIPIENT_NOT_ALLOWED",
      message: error instanceof Error ? error.message : "Invalid recipient or mint",
    });
  }

  const allowlisted = recipients.includes(recipientChecked);
  if (!allowlisted) {
    reasons.push({
      code: input.kind === "sol" ? "SG_E067_RECIPIENT_NOT_ALLOWED" : "SG_E068_RECIPIENT_NOT_ALLOWED",
      message:
        input.kind === "sol"
          ? `Wallet ${recipientChecked} is not on the recipient allowlist`
          : `Destination ATA ${recipientChecked} is not on the recipient allowlist (allowlist the ATA, not just the wallet)`,
    });
  }

  const perTx = findLimit(vault.policy, mint, "perTxLimit");
  const daily = findLimit(vault.policy, mint, "dailyCap");
  if (!perTx) {
    reasons.push({
      code: input.kind === "sol" ? "SG_E063_MINT_NOT_IN_PER_TX_LIMIT" : "SG_E069_MINT_NOT_IN_POLICY",
      message: `Mint ${mint} is not in per-transaction limits`,
    });
  } else if (input.amount > perTx.amount) {
    reasons.push({
      code: "SG_E062_PER_TX_LIMIT_EXCEEDED",
      message: `Amount ${input.amount} exceeds per-tx limit ${perTx.amount} for ${mint}`,
    });
  }

  const spent = spentFor(spend24h, mint);
  if (!daily) {
    reasons.push({
      code: "SG_E065_MINT_NOT_IN_DAILY_CAP",
      message: `Mint ${mint} is not in the 24-hour cap`,
    });
  } else if (spent + input.amount > daily.amount) {
    reasons.push({
      code: "SG_E064_DAILY_CAP_EXCEEDED",
      message: `Amount ${input.amount} plus 24h spent ${spent} exceeds daily cap ${daily.amount} for ${mint}`,
    });
  }

  const serverMax = input.kind === "sol" ? maxLamportsPerCall : maxTokenAmountPerCall;
  if (serverMax !== undefined && input.amount > serverMax) {
    reasons.push({
      code: SERVER_MAX_CODE,
      message: `Amount ${input.amount} exceeds server max per-call ${serverMax}`,
    });
  }

  const remaining = daily ? daily.amount - spent : undefined;

  return {
    ok: reasons.length === 0,
    wouldPass: reasons.length === 0,
    reasons,
    amount: input.amount.toString(),
    mint,
    recipientChecked,
    perTxLimit: perTx?.amount.toString(),
    dailyCap: daily?.amount.toString(),
    spent24h: spent.toString(),
    remaining24h: remaining !== undefined && remaining > 0n ? remaining.toString() : remaining !== undefined ? "0" : undefined,
  };
}
