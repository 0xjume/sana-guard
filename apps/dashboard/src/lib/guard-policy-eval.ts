import {
  ATA_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
} from '@sana-guard/sdk';
import bs58 from 'bs58';
import type { Policy } from '@sana-guard/sdk';

/**
 * TypeScript port of contracts/guard `parse_solana_message` + `process_sign_request`
 * policy checks that apply to the message payload (not agent/vault/req_id state).
 * Used so Attack Lab payloads can be proven rejected before they hit NEAR.
 */

const SYSTEM = SYSTEM_PROGRAM.toBase58();
const TOKEN = TOKEN_PROGRAM.toBase58();
const ATA = ATA_PROGRAM.toBase58();
const COMPUTE_BUDGET = COMPUTE_BUDGET_PROGRAM.toBase58();
const MEMO = MEMO_PROGRAM.toBase58();

const SUPPORTED = new Set([SYSTEM, TOKEN, ATA, COMPUTE_BUDGET, MEMO]);
const DEFAULT_COMPUTE_UNITS_PER_IX = 200_000n;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000n;
const ATA_RENT_LAMPORTS = 2_039_280n;
const BASE_FEE_LAMPORTS = 5_000n;

export type PolicyEvalResult = { code: string } | { accepted: true };

export interface RawInstruction {
  programId: string;
  accounts: string[];
  data: Uint8Array;
}

export interface ParsedSignMessage {
  feePayer: string;
  instructions: RawInstruction[];
}

export type DecodedInstruction =
  | { kind: 'system_transfer'; from: string; to: string; lamports: bigint }
  | {
      kind: 'token_transfer';
      dest: string;
      mint: string | null;
      authority: string;
      amount: bigint;
    }
  | { kind: 'ata_create'; payer: string; ata: string; mint: string }
  | { kind: 'cb_limit'; limit: number }
  | { kind: 'cb_price'; microLamports: bigint }
  | { kind: 'memo'; text: string };

function key(bytes: Uint8Array): string {
  return bs58.encode(Buffer.from(bytes));
}

function readCompactU16(
  bytes: Uint8Array,
  offset: number
): { value: number; size: number } | { code: string } {
  if (offset >= bytes.length) {
    return { code: 'SG_E036_COMPACT_EMPTY' };
  }
  const first = bytes[offset]!;
  if ((first & 0x80) === 0) {
    return { value: first, size: 1 };
  }
  if (offset + 1 >= bytes.length) {
    return { code: 'SG_E037_COMPACT_TRUNCATED' };
  }
  const second = bytes[offset + 1]!;
  if ((first & 0x40) === 0) {
    return { value: (first & 0x7f) | (second << 7), size: 2 };
  }
  if (offset + 2 >= bytes.length) {
    return { code: 'SG_E038_COMPACT_TRUNCATED' };
  }
  const third = bytes[offset + 2]!;
  return {
    value: (first & 0x3f) | (second << 6) | (third << 14),
    size: 3,
  };
}

function readU64Le(data: Uint8Array, offset = 0): bigint {
  const view = Buffer.from(data.subarray(offset, offset + 8));
  return view.readBigUInt64LE(0);
}

function readU32Le(data: Uint8Array, offset = 0): number {
  return (
    (data[offset]! |
      (data[offset + 1]! << 8) |
      (data[offset + 2]! << 16) |
      (data[offset + 3]! << 24)) >>>
    0
  );
}

export function parseSolanaMessage(bytes: Uint8Array): ParsedSignMessage | { code: string } {
  if (bytes.length < 32 || bytes.length > 1167) {
    return { code: 'SG_E001_SIZE' };
  }

  let cursor = 0;
  const version = bytes[0]!;
  let isV0 = false;
  if ((version & 0x80) !== 0) {
    if (version !== 0x80) {
      return { code: 'SG_E002_UNSUPPORTED_VERSION' };
    }
    isV0 = true;
    cursor = 1;
  }

  if (cursor + 3 > bytes.length) {
    return { code: 'SG_E003_TRUNCATED_HEADER' };
  }
  cursor += 3;

  const keysCount = readCompactU16(bytes, cursor);
  if ('code' in keysCount) {
    return keysCount;
  }
  cursor += keysCount.size;
  if (keysCount.value === 0 || keysCount.value > 64) {
    return { code: 'SG_E006_KEY_COUNT' };
  }
  if (cursor + keysCount.value * 32 > bytes.length) {
    return { code: 'SG_E008_TRUNCATED_KEYS' };
  }
  const keys: string[] = [];
  for (let i = 0; i < keysCount.value; i += 1) {
    keys.push(key(bytes.subarray(cursor, cursor + 32)));
    cursor += 32;
  }
  if (cursor + 32 > bytes.length) {
    return { code: 'SG_E009_TRUNCATED_BLOCKHASH' };
  }
  cursor += 32;

  const ixCount = readCompactU16(bytes, cursor);
  if ('code' in ixCount) {
    return ixCount;
  }
  cursor += ixCount.size;
  if (ixCount.value === 0 || ixCount.value > 8) {
    return { code: 'SG_E010_IX_COUNT' };
  }

  const instructions: RawInstruction[] = [];
  for (let i = 0; i < ixCount.value; i += 1) {
    if (cursor >= bytes.length) {
      return { code: 'SG_E011_TRUNCATED_IX' };
    }
    const programIndex = bytes[cursor]!;
    cursor += 1;
    if (programIndex === 0 || programIndex >= keys.length) {
      return { code: 'SG_E012_INVALID_PROGRAM_INDEX' };
    }
    const accountsLen = readCompactU16(bytes, cursor);
    if ('code' in accountsLen) {
      return accountsLen;
    }
    cursor += accountsLen.size;
    if (cursor + accountsLen.value > bytes.length) {
      return { code: 'SG_E013_TRUNCATED_ACCOUNTS' };
    }
    const accounts: string[] = [];
    for (let a = 0; a < accountsLen.value; a += 1) {
      const idx = bytes[cursor]!;
      cursor += 1;
      if (idx >= keys.length) {
        return { code: 'SG_E014_INVALID_ACCOUNT_INDEX' };
      }
      accounts.push(keys[idx]!);
    }
    const dataLen = readCompactU16(bytes, cursor);
    if ('code' in dataLen) {
      return dataLen;
    }
    cursor += dataLen.size;
    if (cursor + dataLen.value > bytes.length) {
      return { code: 'SG_E015_TRUNCATED_DATA' };
    }
    const data = bytes.subarray(cursor, cursor + dataLen.value);
    cursor += dataLen.value;
    instructions.push({ programId: keys[programIndex]!, accounts, data });
  }

  if (isV0) {
    const lookups = readCompactU16(bytes, cursor);
    if ('code' in lookups) {
      return lookups;
    }
    cursor += lookups.size;
    if (lookups.value !== 0) {
      return { code: 'SG_E016_ALT_NOT_ALLOWED' };
    }
  }

  if (cursor !== bytes.length) {
    return { code: 'SG_E017_TRAILING_BYTES' };
  }

  return { feePayer: keys[0]!, instructions };
}

export function decodeInstruction(ix: RawInstruction): DecodedInstruction | { code: string } {
  if (!SUPPORTED.has(ix.programId)) {
    return { code: 'SG_E018_UNKNOWN_PROGRAM' };
  }
  if (ix.programId === SYSTEM) {
    if (ix.data.length < 4) {
      return { code: 'SG_E019_SYSTEM_DATA_TOO_SHORT' };
    }
    const disc = readU32Le(ix.data, 0);
    if (disc !== 2) {
      return { code: 'SG_E022_SYSTEM_UNSUPPORTED' };
    }
    if (ix.data.length !== 12) {
      return { code: 'SG_E020_SYSTEM_TRANSFER_LENGTH' };
    }
    if (ix.accounts.length < 2) {
      return { code: 'SG_E021_SYSTEM_TRANSFER_ACCOUNTS' };
    }
    return {
      kind: 'system_transfer',
      from: ix.accounts[0]!,
      to: ix.accounts[1]!,
      lamports: readU64Le(ix.data, 4),
    };
  }
  if (ix.programId === TOKEN) {
    if (ix.data.length === 0) {
      return { code: 'SG_E023_TOKEN_DATA_EMPTY' };
    }
    const disc = ix.data[0]!;
    if (disc === 3) {
      if (ix.data.length !== 9) {
        return { code: 'SG_E024_TOKEN_TRANSFER_LENGTH' };
      }
      if (ix.accounts.length !== 3) {
        return { code: 'SG_E025_TOKEN_TRANSFER_ACCOUNTS' };
      }
      return {
        kind: 'token_transfer',
        dest: ix.accounts[1]!,
        mint: null,
        authority: ix.accounts[2]!,
        amount: readU64Le(ix.data, 1),
      };
    }
    if (disc === 12) {
      if (ix.data.length !== 10) {
        return { code: 'SG_E026_TOKEN_TRANSFER_CHECKED_LENGTH' };
      }
      if (ix.accounts.length !== 4) {
        return { code: 'SG_E027_TOKEN_TRANSFER_CHECKED_ACCOUNTS' };
      }
      return {
        kind: 'token_transfer',
        dest: ix.accounts[2]!,
        mint: ix.accounts[1]!,
        authority: ix.accounts[3]!,
        amount: readU64Le(ix.data, 1),
      };
    }
    return { code: 'SG_E028_TOKEN_UNSUPPORTED' };
  }
  if (ix.programId === ATA) {
    if (ix.data.length > 0 && ix.data[0] !== 1) {
      return { code: 'SG_E029_ATA_UNSUPPORTED' };
    }
    if (ix.accounts.length !== 6) {
      return { code: 'SG_E030_ATA_ACCOUNTS' };
    }
    return {
      kind: 'ata_create',
      payer: ix.accounts[0]!,
      ata: ix.accounts[1]!,
      mint: ix.accounts[3]!,
    };
  }
  if (ix.programId === COMPUTE_BUDGET) {
    if (ix.data.length === 0) {
      return { code: 'SG_E031_CB_DATA_EMPTY' };
    }
    if (ix.data[0] === 2) {
      if (ix.data.length !== 5) {
        return { code: 'SG_E032_CB_LIMIT_LENGTH' };
      }
      return { kind: 'cb_limit', limit: readU32Le(ix.data, 1) };
    }
    if (ix.data[0] === 3) {
      if (ix.data.length !== 9) {
        return { code: 'SG_E033_CB_PRICE_LENGTH' };
      }
      return { kind: 'cb_price', microLamports: readU64Le(ix.data, 1) };
    }
    return { code: 'SG_E034_CB_UNSUPPORTED' };
  }
  try {
    return { kind: 'memo', text: new TextDecoder('utf-8', { fatal: true }).decode(ix.data) };
  } catch {
    return { code: 'SG_E035_MEMO_INVALID_UTF8' };
  }
}

function mintAllowed(policy: Policy, mint: string): boolean {
  return policy.perTxLimit.some(
    (item) => item.mint.type === 'spl' && item.mint.address.toBase58() === mint
  );
}

function perTxFor(policy: Policy, mint: 'sol' | string): bigint | undefined {
  if (mint === 'sol') {
    return policy.perTxLimit.find((item) => item.mint.type === 'sol')?.amount;
  }
  return policy.perTxLimit.find(
    (item) => item.mint.type === 'spl' && item.mint.address.toBase58() === mint
  )?.amount;
}

function dailyCapFor(policy: Policy, mint: 'sol' | string): bigint | undefined {
  if (mint === 'sol') {
    return policy.dailyCap.find((item) => item.mint.type === 'sol')?.amount;
  }
  return policy.dailyCap.find(
    (item) => item.mint.type === 'spl' && item.mint.address.toBase58() === mint
  )?.amount;
}

function priorityFeeLamports(decoded: DecodedInstruction[]): bigint | { code: string } {
  let limit: bigint | undefined;
  let price: bigint | undefined;
  for (const ix of decoded) {
    if (ix.kind === 'cb_limit') {
      limit = BigInt(ix.limit);
    }
    if (ix.kind === 'cb_price') {
      price = ix.microLamports;
    }
  }
  if (price === undefined) {
    return 0n;
  }
  const units =
    limit ??
    (BigInt(decoded.length) * DEFAULT_COMPUTE_UNITS_PER_IX > MAX_COMPUTE_UNIT_LIMIT
      ? MAX_COMPUTE_UNIT_LIMIT
      : BigInt(decoded.length) * DEFAULT_COMPUTE_UNITS_PER_IX);
  return (units * price + 999_999n) / 1_000_000n;
}

export type SpendMap = Map<string, bigint>;

/**
 * Mirrors `calculate_spend` in parser.rs: transfer amounts, ATA rent, and when
 * a compute-unit price is present, priority fee + 5000 lamport base fee.
 */
export function calculateSpend(
  decoded: DecodedInstruction[],
  vaultAddress: string
): SpendMap | { code: string } {
  const spend: SpendMap = new Map();
  const add = (mint: string, amount: bigint): { code: string } | null => {
    const next = (spend.get(mint) ?? 0n) + amount;
    spend.set(mint, next);
    return null;
  };

  for (const item of decoded) {
    if (item.kind === 'system_transfer') {
      if (item.from !== vaultAddress) {
        return { code: 'SG_E040_WRONG_FROM' };
      }
      add('sol', item.lamports);
    }
    if (item.kind === 'token_transfer') {
      if (item.authority !== vaultAddress) {
        return { code: 'SG_E042_WRONG_AUTHORITY' };
      }
      if (!item.mint) {
        return { code: 'SG_E043_MINT_UNKNOWN' };
      }
      add(item.mint, item.amount);
    }
    if (item.kind === 'ata_create') {
      if (item.payer !== vaultAddress) {
        return { code: 'SG_E045_WRONG_PAYER' };
      }
      add('sol', ATA_RENT_LAMPORTS);
    }
  }

  const fee = priorityFeeLamports(decoded);
  if (typeof fee !== 'bigint') {
    return fee;
  }
  if (decoded.some((item) => item.kind === 'cb_price')) {
    add('sol', fee + BASE_FEE_LAMPORTS);
  }
  return spend;
}

/**
 * Evaluate a compiled Solana message against vault policy in the same order as
 * `process_sign_request` in policy.rs: parse → program allowlist (E074) →
 * per-ix checks (E067–E073, including E072) → max total priority fee (E078) →
 * calculate_spend (transfers + ATA rent + priority fee + 5000 base fee) →
 * per-tx (E062/E063) → rolling 24h daily cap (E064/E065).
 */
export function evaluateSignPayload(
  message: Uint8Array,
  args: {
    vaultAddress: string;
    policy: Policy;
    recipients: string[];
    spend24h?: Array<{ mint: string; amount: bigint }>;
  }
): PolicyEvalResult {
  const parsed = parseSolanaMessage(message);
  if ('code' in parsed) {
    return parsed;
  }
  if (parsed.feePayer !== args.vaultAddress) {
    return { code: 'SG_E061_WRONG_FEE_PAYER' };
  }

  const decoded: DecodedInstruction[] = [];
  for (const ix of parsed.instructions) {
    const item = decodeInstruction(ix);
    if ('code' in item) {
      return item;
    }
    if (!args.policy.programs.includes(ix.programId)) {
      return { code: 'SG_E074_PROGRAM_NOT_ALLOWED' };
    }
    if (item.kind === 'system_transfer' && !args.recipients.includes(item.to)) {
      return { code: 'SG_E067_RECIPIENT_NOT_ALLOWED' };
    }
    if (item.kind === 'token_transfer') {
      if (!args.recipients.includes(item.dest)) {
        return { code: 'SG_E068_RECIPIENT_NOT_ALLOWED' };
      }
      if (item.mint && !mintAllowed(args.policy, item.mint)) {
        return { code: 'SG_E069_MINT_NOT_IN_POLICY' };
      }
    }
    if (item.kind === 'ata_create') {
      if (!args.recipients.includes(item.ata)) {
        return { code: 'SG_E070_ATA_NOT_ALLOWED' };
      }
      if (!mintAllowed(args.policy, item.mint)) {
        return { code: 'SG_E071_MINT_NOT_IN_POLICY' };
      }
    }
    if (item.kind === 'cb_price') {
      if (item.microLamports > args.policy.maxPriorityFeeLamports * 1_000_000n) {
        return { code: 'SG_E072_PRIORITY_FEE_TOO_HIGH' };
      }
    }
    if (item.kind === 'memo' && item.text.length > args.policy.maxMemoLen) {
      return { code: 'SG_E073_MEMO_TOO_LONG' };
    }
    decoded.push(item);
  }

  if (args.policy.maxTotalPriorityFeeLamports !== undefined) {
    const fee = priorityFeeLamports(decoded);
    if (typeof fee !== 'bigint') {
      return fee;
    }
    if (fee > args.policy.maxTotalPriorityFeeLamports) {
      return { code: 'SG_E078_PRIORITY_FEE_TOTAL_TOO_HIGH' };
    }
  }

  const spend = calculateSpend(decoded, args.vaultAddress);
  if ('code' in spend) {
    return spend;
  }

  for (const [mint, amount] of spend) {
    const limit = perTxFor(args.policy, mint);
    if (limit === undefined) {
      return { code: 'SG_E063_MINT_NOT_IN_PER_TX_LIMIT' };
    }
    if (amount > limit) {
      return { code: 'SG_E062_PER_TX_LIMIT_EXCEEDED' };
    }
  }

  const prior = new Map<string, bigint>();
  for (const row of args.spend24h ?? []) {
    prior.set(row.mint, (prior.get(row.mint) ?? 0n) + row.amount);
  }
  for (const [mint, amount] of spend) {
    const cap = dailyCapFor(args.policy, mint);
    if (cap === undefined) {
      return { code: 'SG_E065_MINT_NOT_IN_DAILY_CAP' };
    }
    if ((prior.get(mint) ?? 0n) + amount > cap) {
      return { code: 'SG_E064_DAILY_CAP_EXCEEDED' };
    }
  }

  return { accepted: true };
}

export function rejectionCode(result: PolicyEvalResult): string | null {
  return 'code' in result ? result.code : null;
}
