import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { assertNotV1Message } from '@sana-guard/sdk';

/**
 * Accept a full signed/unsigned Solana transaction or a raw message.
 * Returns the message bytes the contract will parse.
 */
export function extractMessageBytes(serialized: Uint8Array): Uint8Array {
  try {
    const vtx = VersionedTransaction.deserialize(serialized);
    return vtx.message.serialize();
  } catch {
    // not a versioned transaction
  }
  try {
    const tx = Transaction.from(Buffer.from(serialized));
    return Uint8Array.from(tx.serializeMessage());
  } catch {
    // already a message
  }
  assertNotV1Message(serialized);
  return serialized;
}

export function decodeBase64Tx(transactionBase64: string): Uint8Array {
  const raw = Buffer.from(transactionBase64, 'base64');
  if (raw.length === 0) {
    throw new Error('transactionBase64 decoded to empty bytes');
  }
  return extractMessageBytes(Uint8Array.from(raw));
}
