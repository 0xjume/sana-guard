/**
 * Parse owner_vault_count from a contract view.
 * Only non-negative safe integers are accepted. Empty strings and fractions
 * fail closed so a broken RPC result is never treated as zero vaults.
 */
export function parseOwnerVaultCount(raw: unknown, label = 'owner_vault_count'): number {
  const value = readNonNegativeSafeInteger(raw);
  if (value === null) {
    throw new Error(`Invalid ${label}: ${String(raw)}`);
  }
  return value;
}

function readNonNegativeSafeInteger(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 0) {
      return null;
    }
    return raw;
  }
  if (typeof raw === 'string' && /^(0|[1-9]\d*)$/.test(raw)) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      return null;
    }
    return value;
  }
  return null;
}
