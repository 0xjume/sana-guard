import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { buildSolTransfer, encodeCompactU16, TOKEN_PROGRAM, type Policy } from '@sana-guard/sdk';

export type AttackKind =
  | 'over_per_tx_limit'
  | 'non_allowlisted_recipient'
  | 'disallowed_program'
  | 'oversized_priority_fee'
  | 'replay_idempotency';

export const ATTACK_KINDS: AttackKind[] = [
  'over_per_tx_limit',
  'non_allowlisted_recipient',
  'disallowed_program',
  'oversized_priority_fee',
  'replay_idempotency',
];

export const ATTACK_LABELS: Record<AttackKind, string> = {
  over_per_tx_limit: 'Over per-tx limit',
  non_allowlisted_recipient: 'Non-allowlisted recipient',
  disallowed_program: 'Disallowed program',
  oversized_priority_fee: 'Oversized priority fee',
  replay_idempotency: 'Replay idempotency key',
};

export const ATTACK_EXPECTED: Record<AttackKind, string> = {
  over_per_tx_limit: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
  non_allowlisted_recipient: 'SG_E067_RECIPIENT_NOT_ALLOWED',
  disallowed_program: 'SG_E074_PROGRAM_NOT_ALLOWED',
  oversized_priority_fee: 'SG_E072_PRIORITY_FEE_TOO_HIGH',
  replay_idempotency: 'SG_E059_DUPLICATE_REQ_ID',
};

export const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111';

export function solPerTxLimit(policy: Policy): bigint {
  const row = policy.perTxLimit.find((item) => item.mint.type === 'sol');
  return row?.amount ?? 0n;
}

export function pickDisallowedProgram(policy: Policy): string {
  if (!policy.programs.includes(TOKEN_PROGRAM.toBase58())) {
    return TOKEN_PROGRAM.toBase58();
  }
  return 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
}

export function replayIdempotencyKey(): string {
  return 'aa'.repeat(32);
}

function serializeLegacyMessage(message: ReturnType<TransactionMessage['compileToLegacyMessage']>) {
  const header = Buffer.from([
    message.header.numRequiredSignatures,
    message.header.numReadonlySignedAccounts,
    message.header.numReadonlyUnsignedAccounts,
  ]);
  const keysLength = encodeCompactU16(message.staticAccountKeys.length);
  const keys = Buffer.concat(message.staticAccountKeys.map((key) => key.toBuffer()));
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

export function buildProgramProbeMessage(
  from: PublicKey,
  to: PublicKey,
  program: PublicKey,
  recentBlockhash: string
): Uint8Array {
  const message = new TransactionMessage({
    payerKey: from,
    recentBlockhash,
    instructions: [
      SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 1n }),
      new TransactionInstruction({
        keys: [{ pubkey: from, isSigner: true, isWritable: true }],
        programId: program,
        data: Buffer.from([0]),
      }),
    ],
  }).compileToLegacyMessage();
  return serializeLegacyMessage(message);
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
    const program = new PublicKey(pickDisallowedProgram(args.policy));
    const to = new PublicKey(args.allowlistedRecipient ?? BURN_ADDRESS);
    return buildProgramProbeMessage(from, to, program, args.recentBlockhash);
  }

  const to = new PublicKey(args.allowlistedRecipient ?? BURN_ADDRESS);
  const cap = args.policy.maxPriorityFeeLamports;
  const units = 1_400_000;
  const price = ((cap + 1n) * 1_000_000n) / BigInt(units) + 1n;
  return buildSolTransfer(from, to, 1n, args.recentBlockhash, {
    computeUnitLimit: units,
    computeUnitPrice: price,
  });
}
