import { isPreAcceptanceRejection } from './errors.js';

/** Remember the access-key nonce we just signed with. */
export function rememberSignedNonce<T extends { nonce: bigint }>(
  cache: Record<string, T>,
  publicKey: string,
  accessKey: T,
  nonce: bigint
): void {
  cache[publicKey] = { ...accessKey, nonce };
}

/**
 * Drop a cached access key so the next send refetches the on-chain nonce.
 * Only after the node refused the transaction before acceptance.
 */
export function forgetAccessKey(cache: Record<string, unknown>, publicKey: string): void {
  delete cache[publicKey];
}

/**
 * A timeout can mean the signed tx is still in the mempool. Keeping the cached
 * nonce makes the next send use nonce+1. Forgetting it re-reads the chain and
 * can sign the same nonce again.
 */
export function shouldForgetAccessKey(error: unknown): boolean {
  return isPreAcceptanceRejection(error);
}
