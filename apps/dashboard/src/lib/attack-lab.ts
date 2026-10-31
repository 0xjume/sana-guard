import { PublicKey, TransactionInstruction, TransactionMessage } from '@solana/web3.js';
import {
  ATA_PROGRAM,
  MEMO_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  buildSolTransfer,
  encodeCompactU16,
  encodeU64Le,
} from '@sana-guard/sdk';
import bs58 from 'bs58';
import type { Policy } from '@sana-guard/sdk';
import { evaluateSignPayload, rejectionCode } from './guard-policy-eval';

export type AttackKind =
  | 'over_per_tx_limit'
  | 'non_allowlisted_recipient'
  | 'disallowed_program'
  | 'oversized_priority_fee';

export const ATTACK_KINDS: AttackKind[] = [
  'over_per_tx_limit',
  'non_allowlisted_recipient',
  'disallowed_program',
  'oversized_priority_fee',
];

export const ATTACK_LABELS: Record<AttackKind, string> = {
  over_per_tx_limit: 'Over per-tx limit',
  non_allowlisted_recipient: 'Non-allowlisted recipient',
  disallowed_program: 'Disallowed program',
  oversized_priority_fee: 'Oversized priority fee',
};

export const ATTACK_EXPECTED: Record<AttackKind, string> = {
  over_per_tx_limit: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
  non_allowlisted_recipient: 'SG_E067_RECIPIENT_NOT_ALLOWED',
  disallowed_program: 'SG_E074_PROGRAM_NOT_ALLOWED',
  oversized_priority_fee: 'SG_E072_PRIORITY_FEE_TOO_HIGH',
};

export const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111';
const DUMMY_MINT = 'So11111111111111111111111111111111111111112';

const PROBE_PROGRAMS = [TOKEN_PROGRAM.toBase58(), ATA_PROGRAM.toBase58(), MEMO_PROGRAM.toBase58()];

export function solPerTxLimit(policy: Policy): bigint {
  const row = policy.perTxLimit.find((item) => item.mint.type === 'sol');
  return row?.amount ?? 0n;
}

/**
 * Contract E072 is `micro_lamports > max_priority_fee_lamports * 1_000_000`
 * (policy.rs), not a derived (cap+1)*1e6/limit price. The latter is ~71k vs 1e11
 * for a 100k-lamport cap and would be signed.
 */
export function oversizedPriorityFeePrice(policy: Policy): bigint {
  return policy.maxPriorityFeeLamports * 1_000_000n + 1n;
}

export function pickDisallowedProgram(policy: Policy): string {
  const allowed = new Set(policy.programs);
  const probe = PROBE_PROGRAMS.find((program) => !allowed.has(program));
  if (!probe) {
    throw new Error('Every supported probe program is already allowlisted');
  }
  return probe;
}

function serializeLegacyMessage(message: ReturnType<TransactionMessage['compileToLegacyMessage']>) {
  const header = Buffer.from([
    message.header.numRequiredSignatures,
    message.header.numReadonlySignedAccounts,
    message.header.numReadonlyUnsignedAccounts,
  ]);
  const keysLength = encodeCompactU16(message.staticAccountKeys.length);
  const keys = Buffer.concat(message.staticAccountKeys.map((item) => item.toBuffer()));
  const blockhash = Buffer.from(bs58.decode(message.recentBlockhash));
  const ixLen = encodeCompactU16(message.compiledInstructions.length);
  const ixBufs = message.compiledInstructions.map((ix) => {
    const programIdIndex = Buffer.from([ix.programIdIndex]);
    const accountIndexesLength = encodeCompactU16(ix.accountKeyIndexes.length);
    const accountIndexes = Buffer.from(ix.accountKeyIndexes);
    const dataLength = encodeCompactU16(ix.data.length);
    return Buffer.concat([
      programIdIndex,
      accountIndexesLength,
      accountIndexes,
      dataLength,
      Buffer.from(ix.data),
    ]);
  });
  return Buffer.concat([header, keysLength, keys, blockhash, ixLen, ...ixBufs]);
}

function compileLegacy(
  from: PublicKey,
  recentBlockhash: string,
  instructions: TransactionInstruction[]
): Uint8Array {
  const message = new TransactionMessage({
    payerKey: from,
    recentBlockhash,
    instructions,
  }).compileToLegacyMessage();
  return serializeLegacyMessage(message);
}

function tokenTransferCheckedIx(from: PublicKey, to: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    keys: [
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: from, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM,
    data: Buffer.concat([Buffer.from([12]), encodeU64Le(1n), Buffer.from([6])]),
  });
}

function ataCreateIx(from: PublicKey, ata: PublicKey, wallet: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    programId: ATA_PROGRAM,
    data: Buffer.from([1]),
  });
}

function memoIx() {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM,
    data: Buffer.from('x'),
  });
}

export function buildDisallowedProgramMessage(
  from: PublicKey,
  to: PublicKey,
  policy: Policy,
  recentBlockhash: string
): Uint8Array {
  const program = pickDisallowedProgram(policy);
  const mint = new PublicKey(DUMMY_MINT);
  if (program === TOKEN_PROGRAM.toBase58()) {
    return compileLegacy(from, recentBlockhash, [tokenTransferCheckedIx(from, to, mint)]);
  }
  if (program === ATA_PROGRAM.toBase58()) {
    return compileLegacy(from, recentBlockhash, [ataCreateIx(from, to, from, mint)]);
  }
  if (program === MEMO_PROGRAM.toBase58()) {
    return compileLegacy(from, recentBlockhash, [memoIx()]);
  }
  throw new Error(`Unsupported probe program ${program}`);
}

export function buildAttackMessage(args: {
  kind: AttackKind;
  vaultAddress: string;
  recentBlockhash: string;
  policy: Policy;
  allowlistedRecipient?: string;
}): Uint8Array {
  const from = new PublicKey(args.vaultAddress);
  const solLimit = solPerTxLimit(args.policy);

  if (args.kind === 'over_per_tx_limit') {
    const to = new PublicKey(args.allowlistedRecipient ?? BURN_ADDRESS);
    return buildSolTransfer(from, to, solLimit + 1n, args.recentBlockhash);
  }

  if (args.kind === 'non_allowlisted_recipient') {
    return buildSolTransfer(from, new PublicKey(BURN_ADDRESS), 1n, args.recentBlockhash);
  }

  if (args.kind === 'disallowed_program') {
    const to = new PublicKey(args.allowlistedRecipient ?? BURN_ADDRESS);
    return buildDisallowedProgramMessage(from, to, args.policy, args.recentBlockhash);
  }

  const to = new PublicKey(args.allowlistedRecipient ?? BURN_ADDRESS);
  return buildSolTransfer(from, to, 1n, args.recentBlockhash, {
    computeUnitPrice: oversizedPriorityFeePrice(args.policy),
  });
}

export function expectedRejectionForMessage(
  kind: AttackKind,
  message: Uint8Array,
  args: { vaultAddress: string; policy: Policy; recipients: string[] }
): string {
  const code = rejectionCode(evaluateSignPayload(message, args));
  if (!code) {
    throw new Error(`${kind} payload would be accepted by the contract policy checks`);
  }
  return code;
}
