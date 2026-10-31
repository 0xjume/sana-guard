import bs58 from "bs58";

/**
 * Convert a guard `get_request` signature (base64 of 64 raw bytes) into the
 * Solana transaction signature the first write call returns (base58).
 */
export function solanaSignatureBase58(
  raw?: string | number[] | Uint8Array | null
): string | undefined {
  if (raw == null) {
    return undefined;
  }

  if (typeof raw !== "string") {
    const bytes = Uint8Array.from(raw);
    return bytes.length === 64 ? bs58.encode(bytes) : undefined;
  }

  try {
    const asB58 = bs58.decode(raw);
    if (asB58.length === 64) {
      return raw;
    }
  } catch {
    // not base58
  }

  const asB64 = Buffer.from(raw, "base64");
  if (asB64.length === 64) {
    return bs58.encode(asB64);
  }

  return undefined;
}
