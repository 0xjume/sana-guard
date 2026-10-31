import { Message, PublicKey, VersionedMessage } from "@solana/web3.js";
import bs58 from "bs58";
import {
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  type VaultView,
} from "@sana-guard/sdk";
import { SERVER_MAX_CODE, UNACCOUNTABLE_CODE } from "./errors.js";
import { findLimit, normalizeSpendMint, spentFor, type CheckReason } from "./policyCheck.js";

/** Memo v2 — the only memo program the contract parser accepts. */
export const MEMO_V2_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const ATA_RENT_LAMPORTS = 2_039_280n;
const SIGNATURE_BASE_FEE = 5_000n;
/** Mirrors the contract: runtime default CU per instruction when no setLimit is present. */
const DEFAULT_COMPUTE_UNITS_PER_IX = 200_000n;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000n;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

export type OutflowTransfer = {
  kind: "sol" | "spl";
  to: string;
  amount: bigint;
  mint: string;
};

export type OutflowSpend = {
  mint: string;
  amount: bigint;
};

export type AccountedOutflow = {
  ok: true;
  feePayer: string;
  programs: string[];
  transfers: OutflowTransfer[];
  spend: OutflowSpend[];
  /** Priority fee in lamports (excluding the base signature fee). */
  priorityFee: bigint;
};

export type UnaccountedOutflow = {
  ok: false;
  code: string;
  message: string;
};

export type VaultOutflow = AccountedOutflow | UnaccountedOutflow;

type CompiledIx = {
  programIdIndex: number;
  accounts: number[];
  data: Uint8Array;
};

type WireMessage = {
  accountKeys: PublicKey[];
  instructions: CompiledIx[];
};

function fail(code: string, message: string): UnaccountedOutflow {
  return { ok: false, code, message };
}

function readU32Le(data: Uint8Array, offset = 0): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}

function readU64Le(data: Uint8Array, offset = 0): bigint {
  const view = Buffer.from(data.subarray(offset, offset + 8));
  return view.readBigUInt64LE(0);
}

function keysEqual(a: PublicKey, b: PublicKey): boolean {
  return a.equals(b);
}

function decodeWireMessage(bytes: Uint8Array): WireMessage | UnaccountedOutflow {
  if (bytes.length < 32 || bytes.length > 1167) {
    return fail("SG_E001_SIZE", "Message size out of bounds (32-1167 bytes)");
  }
  if (bytes[0] === 0x81) {
    return fail("SG_E002_UNSUPPORTED_VERSION", "Unsupported message version (only legacy and v0 allowed)");
  }

  if ((bytes[0]! & 0x80) !== 0) {
    if (bytes[0] !== 0x80) {
      return fail("SG_E002_UNSUPPORTED_VERSION", "Unsupported message version (only legacy and v0 allowed)");
    }
    try {
      const msg = VersionedMessage.deserialize(bytes);
      if (msg.addressTableLookups.length > 0) {
        return fail("SG_E016_ALT_NOT_ALLOWED", "Address lookup tables not allowed");
      }
      return {
        accountKeys: msg.staticAccountKeys,
        instructions: msg.compiledInstructions.map((ix) => ({
          programIdIndex: ix.programIdIndex,
          accounts: [...ix.accountKeyIndexes],
          data: Uint8Array.from(ix.data),
        })),
      };
    } catch (error) {
      return fail(
        UNACCOUNTABLE_CODE,
        error instanceof Error ? error.message : "Could not decode versioned message"
      );
    }
  }

  try {
    const msg = Message.from(Buffer.from(bytes));
    return {
      accountKeys: msg.accountKeys,
      instructions: msg.compiledInstructions.map((ix) => ({
        programIdIndex: ix.programIdIndex,
        accounts: [...ix.accountKeyIndexes],
        data: decodeCompiledData(ix.data),
      })),
    };
  } catch (error) {
    return fail(
      UNACCOUNTABLE_CODE,
      error instanceof Error ? error.message : "Could not decode legacy message"
    );
  }
}

function decodeCompiledData(data: string | Uint8Array | Buffer): Uint8Array {
  if (typeof data !== "string") {
    return Uint8Array.from(data);
  }
  return Uint8Array.from(bs58.decode(data));
}

/**
 * Decode a Solana message and compute vault outflow the same way the
 * contract `calculate_spend` does. Rejects anything we cannot fully account
 * for (unknown programs, unsupported instructions, unchecked token transfers).
 */
export function accountVaultOutflow(message: Uint8Array, vaultAddress: PublicKey): VaultOutflow {
  const wire = decodeWireMessage(message);
  if (!("accountKeys" in wire)) {
    return wire;
  }

  const { accountKeys, instructions } = wire;
  if (accountKeys.length === 0) {
    return fail("SG_E006_KEY_COUNT", "Invalid key count (must be 1-64)");
  }

  const feePayer = accountKeys[0]!;
  const programs: string[] = [];
  const transfers: OutflowTransfer[] = [];
  const spendMap = new Map<string, bigint>();
  let computeLimit: number | undefined;
  let computePrice: bigint | undefined;

  const addSpend = (mint: string, amount: bigint, code: string): UnaccountedOutflow | undefined => {
    const prev = spendMap.get(mint) ?? 0n;
    const next = prev + amount;
    if (next < prev) {
      return fail(code, "Spend calculation overflow");
    }
    spendMap.set(mint, next);
    return undefined;
  };

  for (const ix of instructions) {
    const program = accountKeys[ix.programIdIndex];
    if (!program) {
      return fail("SG_E012_INVALID_PROGRAM_INDEX", "Invalid program ID index");
    }
    const programId = program.toBase58();
    if (!programs.includes(programId)) {
      programs.push(programId);
    }

    if (keysEqual(program, SYSTEM_PROGRAM)) {
      if (ix.data.length < 4) {
        return fail("SG_E019_SYSTEM_DATA_TOO_SHORT", "System instruction data too short");
      }
      const discriminator = readU32Le(ix.data);
      if (discriminator !== 2) {
        return fail("SG_E022_SYSTEM_UNSUPPORTED", "Unsupported System instruction");
      }
      if (ix.data.length !== 12) {
        return fail("SG_E020_SYSTEM_TRANSFER_LENGTH", "System transfer data wrong length");
      }
      if (ix.accounts.length !== 2) {
        return fail("SG_E021_SYSTEM_TRANSFER_ACCOUNTS", "System transfer wrong account count");
      }
      const from = accountKeys[ix.accounts[0]!];
      const to = accountKeys[ix.accounts[1]!];
      if (!from || !to) {
        return fail("SG_E014_INVALID_ACCOUNT_INDEX", "Invalid account index");
      }
      if (!keysEqual(from, vaultAddress)) {
        return fail("SG_E040_WRONG_FROM", "System transfer from address is not vault address");
      }
      const lamports = readU64Le(ix.data, 4);
      transfers.push({ kind: "sol", to: to.toBase58(), amount: lamports, mint: "SOL" });
      const overflow = addSpend("SOL", lamports, "SG_E041_OVERFLOW");
      if (overflow) {
        return overflow;
      }
      continue;
    }

    if (keysEqual(program, TOKEN_PROGRAM)) {
      if (ix.data.length === 0) {
        return fail("SG_E023_TOKEN_DATA_EMPTY", "Token instruction data empty");
      }
      const discriminator = ix.data[0]!;
      if (discriminator === 3) {
        return fail(
          "SG_E043_MINT_UNKNOWN",
          "Token transfer mint unknown (must use transferChecked)"
        );
      }
      if (discriminator !== 12) {
        return fail("SG_E028_TOKEN_UNSUPPORTED", "Unsupported Token instruction");
      }
      if (ix.data.length !== 10) {
        return fail("SG_E026_TOKEN_TRANSFER_CHECKED_LENGTH", "Token transferChecked data wrong length");
      }
      if (ix.accounts.length !== 4) {
        return fail("SG_E027_TOKEN_TRANSFER_CHECKED_ACCOUNTS", "Token transferChecked wrong account count");
      }
      const dest = accountKeys[ix.accounts[2]!];
      const authority = accountKeys[ix.accounts[3]!];
      const mint = accountKeys[ix.accounts[1]!];
      if (!dest || !authority || !mint) {
        return fail("SG_E014_INVALID_ACCOUNT_INDEX", "Invalid account index");
      }
      if (!keysEqual(authority, vaultAddress)) {
        return fail("SG_E042_WRONG_AUTHORITY", "Token transfer authority is not vault address");
      }
      const amount = readU64Le(ix.data, 1);
      const mintKey = mint.toBase58();
      transfers.push({ kind: "spl", to: dest.toBase58(), amount, mint: mintKey });
      const overflow = addSpend(mintKey, amount, "SG_E044_OVERFLOW");
      if (overflow) {
        return overflow;
      }
      continue;
    }

    if (keysEqual(program, ATA_PROGRAM)) {
      if (ix.data.length > 0 && ix.data[0] !== 1) {
        return fail("SG_E029_ATA_UNSUPPORTED", "Unsupported ATA instruction (only create-idempotent allowed)");
      }
      if (ix.accounts.length !== 6) {
        return fail("SG_E030_ATA_ACCOUNTS", "ATA create wrong account count");
      }
      const payer = accountKeys[ix.accounts[0]!];
      const ata = accountKeys[ix.accounts[1]!];
      if (!payer || !ata) {
        return fail("SG_E014_INVALID_ACCOUNT_INDEX", "Invalid account index");
      }
      if (!keysEqual(payer, vaultAddress)) {
        return fail("SG_E045_WRONG_PAYER", "ATA create payer is not vault address");
      }
      transfers.push({ kind: "sol", to: ata.toBase58(), amount: ATA_RENT_LAMPORTS, mint: "SOL" });
      const overflow = addSpend("SOL", ATA_RENT_LAMPORTS, "SG_E046_OVERFLOW");
      if (overflow) {
        return overflow;
      }
      continue;
    }

    if (keysEqual(program, COMPUTE_BUDGET_PROGRAM)) {
      if (ix.data.length === 0) {
        return fail("SG_E031_CB_DATA_EMPTY", "ComputeBudget instruction data empty");
      }
      const discriminator = ix.data[0]!;
      if (discriminator === 2) {
        if (ix.data.length !== 5) {
          return fail("SG_E032_CB_LIMIT_LENGTH", "ComputeBudget setLimit data wrong length");
        }
        if (computeLimit !== undefined) {
          return fail("SG_E047_DUPLICATE_CB_LIMIT", "Duplicate ComputeBudget setLimit instruction");
        }
        computeLimit = readU32Le(ix.data, 1);
        continue;
      }
      if (discriminator === 3) {
        if (ix.data.length !== 9) {
          return fail("SG_E033_CB_PRICE_LENGTH", "ComputeBudget setPrice data wrong length");
        }
        if (computePrice !== undefined) {
          return fail("SG_E048_DUPLICATE_CB_PRICE", "Duplicate ComputeBudget setPrice instruction");
        }
        computePrice = readU64Le(ix.data, 1);
        continue;
      }
      return fail("SG_E034_CB_UNSUPPORTED", "Unsupported ComputeBudget instruction");
    }

    if (keysEqual(program, MEMO_V2_PROGRAM)) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(ix.data);
      } catch {
        return fail("SG_E035_MEMO_INVALID_UTF8", "Memo text is not valid UTF-8");
      }
      continue;
    }

    return fail(
      "SG_E018_UNKNOWN_PROGRAM",
      `Program ${programId} is not on the contract allowlist; cannot account for fund movement`
    );
  }

  // Same rule as the contract's priority_fee_lamports: a price without a limit is charged on the
  // runtime default limit, so it must count too.
  let priorityFee = 0n;
  if (computePrice !== undefined) {
    const defaultLimit = BigInt(instructions.length) * DEFAULT_COMPUTE_UNITS_PER_IX;
    const limit =
      computeLimit !== undefined
        ? BigInt(computeLimit)
        : defaultLimit < MAX_COMPUTE_UNIT_LIMIT
          ? defaultLimit
          : MAX_COMPUTE_UNIT_LIMIT;
    const product = limit * computePrice + 999_999n;
    if (product > U64_MAX) {
      return fail("SG_E049_OVERFLOW", "Priority fee overflows u64");
    }
    priorityFee = product / 1_000_000n;
    const totalFee = priorityFee + SIGNATURE_BASE_FEE;
    const overflow = addSpend("SOL", totalFee, "SG_E050_OVERFLOW");
    if (overflow) {
      return overflow;
    }
  }

  return {
    ok: true,
    feePayer: feePayer.toBase58(),
    programs,
    transfers,
    spend: [...spendMap.entries()].map(([mint, amount]) => ({ mint, amount })),
    priorityFee,
  };
}

export interface CheckSignMessageResult {
  ok: boolean;
  wouldPass: boolean;
  reasons: CheckReason[];
  feePayer?: string;
  programs?: string[];
  transfers?: Array<{ kind: string; to: string; amount: string; mint: string }>;
  spend?: Array<{ mint: string; amount: string }>;
}

/**
 * Policy + server max-per-call pre-check for an arbitrary sign_transaction message.
 */
export async function checkSignMessage(opts: {
  message: Uint8Array;
  vaultAddress: PublicKey;
  vault: VaultView | null;
  recipients: string[];
  spend24h: Array<{ mint: string; amount: bigint }>;
  nowNs: bigint;
  maxLamportsPerCall?: bigint;
  maxTokenAmountPerCall?: bigint;
}): Promise<CheckSignMessageResult> {
  const outflow = accountVaultOutflow(opts.message, opts.vaultAddress);
  if (!outflow.ok) {
    return {
      ok: false,
      wouldPass: false,
      reasons: [{ code: outflow.code, message: outflow.message }],
    };
  }

  const reasons: CheckReason[] = [];
  const { vault, recipients, spend24h, nowNs } = opts;

  if (!vault) {
    reasons.push({ code: "SG_E054_VAULT_NOT_FOUND", message: "Vault not found" });
    return { ok: false, wouldPass: false, reasons, ...summarize(outflow) };
  }

  if (!outflow.feePayer || outflow.feePayer !== opts.vaultAddress.toBase58()) {
    reasons.push({
      code: "SG_E061_WRONG_FEE_PAYER",
      message: "Message fee payer is not vault address",
    });
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

  for (const program of outflow.programs) {
    if (!vault.policy.programs.includes(program)) {
      reasons.push({
        code: "SG_E074_PROGRAM_NOT_ALLOWED",
        message: `Program ${program} is not in the vault program allowlist`,
      });
    }
  }

  for (const transfer of outflow.transfers) {
    if (!recipients.includes(transfer.to)) {
      reasons.push({
        code: transfer.kind === "sol" ? "SG_E067_RECIPIENT_NOT_ALLOWED" : "SG_E068_RECIPIENT_NOT_ALLOWED",
        message:
          transfer.kind === "sol"
            ? `Wallet ${transfer.to} is not on the recipient allowlist`
            : `Destination ATA ${transfer.to} is not on the recipient allowlist (allowlist the ATA, not just the wallet)`,
      });
    }
  }

  const maxTotalFee = vault.policy.maxTotalPriorityFeeLamports;
  if (maxTotalFee !== undefined && outflow.priorityFee > maxTotalFee) {
    reasons.push({
      code: "SG_E078_PRIORITY_FEE_TOTAL_TOO_HIGH",
      message: `Priority fee ${outflow.priorityFee} exceeds policy max ${maxTotalFee} lamports`,
    });
  }

  for (const row of outflow.spend) {
    const key = normalizeSpendMint(row.mint);
    const perTx = findLimit(vault.policy, key, "perTxLimit");
    const daily = findLimit(vault.policy, key, "dailyCap");
    const isSol = key === "SOL";

    if (!perTx) {
      reasons.push({
        code: isSol ? "SG_E063_MINT_NOT_IN_PER_TX_LIMIT" : "SG_E069_MINT_NOT_IN_POLICY",
        message: `Mint ${key} is not in per-transaction limits`,
      });
    } else if (row.amount > perTx.amount) {
      reasons.push({
        code: "SG_E062_PER_TX_LIMIT_EXCEEDED",
        message: `Amount ${row.amount} exceeds per-tx limit ${perTx.amount} for ${key}`,
      });
    }

    const spent = spentFor(spend24h, key);
    if (!daily) {
      reasons.push({
        code: "SG_E065_MINT_NOT_IN_DAILY_CAP",
        message: `Mint ${key} is not in the 24-hour cap`,
      });
    } else if (spent + row.amount > daily.amount) {
      reasons.push({
        code: "SG_E064_DAILY_CAP_EXCEEDED",
        message: `Amount ${row.amount} plus 24h spent ${spent} exceeds daily cap ${daily.amount} for ${key}`,
      });
    }

    const serverMax = isSol ? opts.maxLamportsPerCall : opts.maxTokenAmountPerCall;
    if (serverMax !== undefined && row.amount > serverMax) {
      reasons.push({
        code: SERVER_MAX_CODE,
        message: `Amount ${row.amount} exceeds server max per-call ${serverMax}`,
      });
    }
  }

  return {
    ok: reasons.length === 0,
    wouldPass: reasons.length === 0,
    reasons,
    ...summarize(outflow),
  };
}

function summarize(outflow: AccountedOutflow) {
  return {
    feePayer: outflow.feePayer,
    programs: outflow.programs,
    transfers: outflow.transfers.map((row) => ({
      kind: row.kind,
      to: row.to,
      amount: row.amount.toString(),
      mint: row.mint,
    })),
    spend: outflow.spend.map((row) => ({ mint: row.mint, amount: row.amount.toString() })),
  };
}
