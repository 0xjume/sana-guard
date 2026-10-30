import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createTransferCheckedInstruction, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { MessageVersion } from './types';
import { SanaGuardError } from './errors';

// Supported program IDs (must match contract parser)
export const SYSTEM_PROGRAM = SystemProgram.programId;
export const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
export const ATA_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;
export const COMPUTE_BUDGET_PROGRAM = ComputeBudgetProgram.programId;
export const MEMO_V2_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

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
  } = {}
): Uint8Array {
  const { version = 'v0', computeUnitLimit, computeUnitPrice } = options;

  const instructions: TransactionInstruction[] = [];

  // Add ComputeBudget instructions if provided
  if (computeUnitLimit !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })
    );
  }

  if (computeUnitPrice !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(computeUnitPrice) })
    );
  }

  // Add transfer instruction
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: Number(lamports),
    })
  );

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
  } = {}
): Uint8Array {
  const { version = 'v0', computeUnitLimit, computeUnitPrice, createAta = false } = options;

  const instructions: TransactionInstruction[] = [];

  // Add ComputeBudget instructions if provided
  if (computeUnitLimit !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })
    );
  }

  if (computeUnitPrice !== undefined) {
    instructions.push(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(computeUnitPrice) })
    );
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
  version: MessageVersion = 'v0'
): Uint8Array {
  if (Buffer.from(memo, 'utf-8').length > 566) {
    throw new SanaGuardError('Memo too long (max 566 bytes)');
  }

  const memoInstruction = new TransactionInstruction({
    keys: [],
    programId: MEMO_V2_PROGRAM,
    data: Buffer.from(memo, 'utf-8'),
  });

  const allInstructions = [...instructions, memoInstruction];

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
  const bs58 = require('bs58');
  const blockhash = Buffer.from(bs58.default ? bs58.default.decode(message.recentBlockhash) : bs58.decode(message.recentBlockhash));

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
  const bs58 = require('bs58');
  const blockhash = Buffer.from(bs58.default ? bs58.default.decode(message.recentBlockhash) : bs58.decode(message.recentBlockhash));

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
