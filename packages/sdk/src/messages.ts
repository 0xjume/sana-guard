import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import { MessageVersion } from './types';
import { SanaGuardError } from './errors';

function encodeBase58(bytes: Uint8Array): string {
  return bs58.encode(Buffer.from(bytes));
}

function decodeBase58(value: string): Buffer {
  return Buffer.from(bs58.decode(value));
}

// Supported program IDs (must match contract parser)
export const SYSTEM_PROGRAM = SystemProgram.programId;
export const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
export const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;
export const COMPUTE_BUDGET_PROGRAM = ComputeBudgetProgram.programId;
export const MEMO_PROGRAM = new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo');

/** Maximum value that fits in a Solana u64 field. */
export const U64_MAX = BigInt('18446744073709551615');

/**
 * Encode a bigint as little-endian u64. Rejects negatives and values above u64 max
 * without going through Number(), which cannot represent every u64 exactly.
 */
export function encodeU64Le(value: bigint): Buffer {
  if (value < BigInt(0) || value > U64_MAX) {
    throw new SanaGuardError(`u64 out of range: ${value}`);
  }
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

/**
 * ComputeBudget SetComputeUnitPrice data: discriminator 3 + little-endian u64.
 */
export function encodeComputeUnitPriceData(microLamports: bigint): Buffer {
  return Buffer.concat([Buffer.from([3]), encodeU64Le(microLamports)]);
}

/**
 * ComputeBudget SetComputeUnitPrice instruction, encoded without Number().
 */
export function setComputeUnitPriceInstruction(microLamports: bigint): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: COMPUTE_BUDGET_PROGRAM,
    data: encodeComputeUnitPriceData(microLamports),
  });
}

function memoInstruction(memo: string, maxMemoLen: number): TransactionInstruction {
  const memoBytes = Buffer.from(memo, 'utf-8');
  if (memoBytes.length > maxMemoLen) {
    throw new SanaGuardError(`Memo too long (max ${maxMemoLen} bytes)`);
  }
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM,
    data: memoBytes,
  });
}

/**
 * Compact-u16 encoding for Solana message format
 */
function encodeCompactU16(n: number): Buffer {
  if (n < 0 || n > 65535) {
    throw new SanaGuardError('Compact-u16 out of range');
  }

  if (n < 0x80) {
    return Buffer.from([n]);
  } else if (n < 0x4000) {
    return Buffer.from([
      (n & 0x7f) | 0x80,
      (n >> 7) & 0xff,
    ]);
  } else {
    return Buffer.from([
      (n & 0x3f) | 0xc0,
      (n >> 6) & 0xff,
      (n >> 14) & 0xff,
    ]);
  }
}

/**
 * Build a Solana message for a SOL transfer
 */
export function buildSolTransfer(
  from: PublicKey,
  to: PublicKey,
  lamports: bigint,
  recentBlockhash: string,
  options: {
    version?: MessageVersion;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
    memo?: string;
    maxMemoLen?: number;
  } = {}
): Uint8Array {
  const { version = 'v0', computeUnitLimit, computeUnitPrice, memo, maxMemoLen = 64 } = options;

  const instructions: TransactionInstruction[] = [];

  // Add ComputeBudget instructions if provided
  if (computeUnitLimit !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })
    );
  }

  if (computeUnitPrice !== undefined) {
    instructions.push(setComputeUnitPriceInstruction(computeUnitPrice));
  }

  // Add transfer instruction
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: BigInt(lamports),
    })
  );

  if (memo) {
    instructions.push(memoInstruction(memo, maxMemoLen));
  }

  if (version === 'v0') {
    const message = new TransactionMessage({
      payerKey: from,
      recentBlockhash,
      instructions,
    }).compileToV0Message();

    return serializeV0Message(message);
  } else {
    const message = new TransactionMessage({
      payerKey: from,
      recentBlockhash,
      instructions,
    }).compileToLegacyMessage();

    return serializeLegacyMessage(message);
  }
}

/**
 * Build a Solana message for an SPL token transfer
 */
export function buildTokenTransfer(
  from: PublicKey,
  to: PublicKey,
  mint: PublicKey,
  amount: bigint,
  decimals: number,
  fromTokenAccount: PublicKey,
  toTokenAccount: PublicKey,
  recentBlockhash: string,
  options: {
    version?: MessageVersion;
    computeUnitLimit?: number;
    computeUnitPrice?: bigint;
    createAta?: boolean;
    memo?: string;
    maxMemoLen?: number;
  } = {}
): Uint8Array {
  const { version = 'v0', computeUnitLimit, computeUnitPrice, createAta = false, memo, maxMemoLen = 64 } = options;

  const instructions: TransactionInstruction[] = [];

  // Add ComputeBudget instructions if provided
  if (computeUnitLimit !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })
    );
  }

  if (computeUnitPrice !== undefined) {
    instructions.push(setComputeUnitPriceInstruction(computeUnitPrice));
  }

  // Optionally create ATA idempotently
  if (createAta) {
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        from, // payer
        toTokenAccount,
        to, // owner
        mint
      )
    );
  }

  // Add transferChecked instruction
  instructions.push(
    createTransferCheckedInstruction(
      fromTokenAccount,
      mint,
      toTokenAccount,
      from, // authority
      BigInt(amount.toString()),
      decimals
    )
  );

  if (memo) {
    instructions.push(memoInstruction(memo, maxMemoLen));
  }

  if (version === 'v0') {
    const message = new TransactionMessage({
      payerKey: from,
      recentBlockhash,
      instructions,
    }).compileToV0Message();

    return serializeV0Message(message);
  } else {
    const message = new TransactionMessage({
      payerKey: from,
      recentBlockhash,
      instructions,
    }).compileToLegacyMessage();

    return serializeLegacyMessage(message);
  }
}

/**
 * Add a memo instruction to a message
 */
export function buildMessageWithMemo(
  from: PublicKey,
  recentBlockhash: string,
  memo: string,
  instructions: TransactionInstruction[],
  maxMemoLen: number,
  version: MessageVersion = 'v0'
): Uint8Array {
  const allInstructions = memo
    ? [...instructions, memoInstruction(memo, maxMemoLen)]
    : instructions;

  if (version === 'v0') {
    const message = new TransactionMessage({
      payerKey: from,
      recentBlockhash,
      instructions: allInstructions,
    }).compileToV0Message();

    return serializeV0Message(message);
  } else {
    const message = new TransactionMessage({
      payerKey: from,
      recentBlockhash,
      instructions: allInstructions,
    }).compileToLegacyMessage();

    return serializeLegacyMessage(message);
  }
}

/**
 * Serialize a v0 message to bytes matching contract parser expectations
 */
function serializeV0Message(message: any): Uint8Array {
  // Version byte 0x80 for v0
  const versionByte = Buffer.from([0x80]);

  // Header: numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts
  const header = Buffer.from([
    message.header.numRequiredSignatures,
    message.header.numReadonlySignedAccounts,
    message.header.numReadonlyUnsignedAccounts,
  ]);

  // Account keys
  const numKeys = message.staticAccountKeys.length;
  const keysLength = encodeCompactU16(numKeys);
  const keys = Buffer.concat(message.staticAccountKeys.map((k: PublicKey) => k.toBuffer()));

  // Recent blockhash
  const blockhash = decodeBase58(message.recentBlockhash);

  // Instructions
  const numInstructions = message.compiledInstructions.length;
  const instructionsLength = encodeCompactU16(numInstructions);
  const instructionsBuffers = message.compiledInstructions.map((ix: any) => {
    const programIdIndex = Buffer.from([ix.programIdIndex]);
    const accountIndexesLength = encodeCompactU16(ix.accountKeyIndexes.length);
    const accountIndexes = Buffer.from(ix.accountKeyIndexes);
    const dataLength = encodeCompactU16(ix.data.length);
    const data = Buffer.from(ix.data);
    return Buffer.concat([programIdIndex, accountIndexesLength, accountIndexes, dataLength, data]);
  });

  // Address lookup tables (must be empty for Sana Guard)
  const addressLookupTablesLength = encodeCompactU16(0);

  return Buffer.concat([
    versionByte,
    header,
    keysLength,
    keys,
    blockhash,
    instructionsLength,
    ...instructionsBuffers,
    addressLookupTablesLength,
  ]);
}

/**
 * Serialize a legacy message to bytes matching contract parser expectations
 */
function serializeLegacyMessage(message: any): Uint8Array {
  // No version byte for legacy

  // Header: numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts
  const header = Buffer.from([
    message.header.numRequiredSignatures,
    message.header.numReadonlySignedAccounts,
    message.header.numReadonlyUnsignedAccounts,
  ]);

  // Account keys
  const numKeys = message.staticAccountKeys.length;
  const keysLength = encodeCompactU16(numKeys);
  const keys = Buffer.concat(message.staticAccountKeys.map((k: PublicKey) => k.toBuffer()));

  // Recent blockhash
  const blockhash = decodeBase58(message.recentBlockhash);

  // Instructions
  const numInstructions = message.compiledInstructions.length;
  const instructionsLength = encodeCompactU16(numInstructions);
  const instructionsBuffers = message.compiledInstructions.map((ix: any) => {
    const programIdIndex = Buffer.from([ix.programIdIndex]);
    const accountIndexesLength = encodeCompactU16(ix.accountKeyIndexes.length);
    const accountIndexes = Buffer.from(ix.accountKeyIndexes);
    const dataLength = encodeCompactU16(ix.data.length);
    const data = Buffer.from(ix.data);
    return Buffer.concat([programIdIndex, accountIndexesLength, accountIndexes, dataLength, data]);
  });

  return Buffer.concat([
    header,
    keysLength,
    keys,
    blockhash,
    instructionsLength,
    ...instructionsBuffers,
  ]);
}

/**
 * Enforce that a message is NOT the new v1 (0x81) format
 */
export function assertNotV1Message(message: Uint8Array): void {
  if (message[0] === 0x81) {
    throw new SanaGuardError('v1 (0x81) messages are not supported by Sana Guard');
  }
}

/**
 * Verify the message signature locally against the vault address
 */
export async function verifyMessageSignature(
  signature: Uint8Array,
  message: Uint8Array,
  vaultAddress: PublicKey
): Promise<boolean> {
  const nacl = await import('tweetnacl');
  
  if (signature.length !== 64) {
    return false;
  }

  // Ed25519 signature verification: nacl.sign.detached.verify(message, signature, publicKey)
  const messageWithSig = Buffer.concat([signature, message]);
  try {
    const opened = nacl.sign.open(messageWithSig, vaultAddress.toBytes());
    return opened !== null;
  } catch {
    return false;
  }
}

/**
 * Assemble a signed transaction ready for broadcast
 */
export function assembleSignedTransaction(
  signature: Uint8Array,
  message: Uint8Array
): Uint8Array {
  // Compact-u16 encoding of number of signatures (always 1)
  const numSignatures = encodeCompactU16(1);
  return Buffer.concat([numSignatures, Buffer.from(signature), Buffer.from(message)]);
}

function decodeCompactU16(bytes: Uint8Array, offset: number): { value: number; size: number } {
  if (offset >= bytes.length) {
    throw new SanaGuardError('Compact-u16 buffer empty');
  }
  const first = bytes[offset];
  if ((first & 0x80) === 0) {
    return { value: first, size: 1 };
  }
  if (offset + 1 >= bytes.length) {
    throw new SanaGuardError('Compact-u16 truncated');
  }
  const second = bytes[offset + 1];
  if ((first & 0x40) === 0) {
    return { value: (first & 0x7f) | (second << 7), size: 2 };
  }
  if (offset + 2 >= bytes.length) {
    throw new SanaGuardError('Compact-u16 truncated');
  }
  const third = bytes[offset + 2];
  return {
    value: (first & 0x3f) | (second << 6) | (third << 14),
    size: 3,
  };
}

function decodeBs58(data: Uint8Array): string {
  return encodeBase58(data);
}

/**
 * Read the recent blockhash that was compiled into a legacy or v0 message.
 * Used so confirmation talks about the signed message, not a freshly fetched hash.
 */
export function extractRecentBlockhash(message: Uint8Array): string {
  if (message.length < 36) {
    throw new SanaGuardError('Message too short to contain a blockhash');
  }

  let cursor = 0;
  const version = message[0];
  if ((version & 0x80) !== 0) {
    if (version !== 0x80) {
      throw new SanaGuardError('Unsupported message version');
    }
    cursor = 1;
  }

  if (cursor + 3 > message.length) {
    throw new SanaGuardError('Message header is truncated');
  }
  cursor += 3;

  const keys = decodeCompactU16(message, cursor);
  cursor += keys.size + keys.value * 32;

  if (cursor + 32 > message.length) {
    throw new SanaGuardError('Message blockhash is truncated');
  }

  return decodeBs58(message.slice(cursor, cursor + 32));
}
