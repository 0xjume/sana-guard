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
 * Call this on any send error (including InvalidNonce).
 */
export function forgetAccessKey(
  cache: Record<string, unknown>,
  publicKey: string
): void {
  delete cache[publicKey];
}
