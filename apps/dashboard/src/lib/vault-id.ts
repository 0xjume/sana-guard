const U32_MAX = 4_294_967_295n;

/**
 * Parse a `/vaults/[id]` segment.
 * Only canonical decimal forms that fit a u32 are vault ids: `0` or `[1-9][0-9]*`
 * with value ≤ 4294967295. Leading zeros, signs, and overflow are rejected.
 */
export function parseVaultId(id: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(id)) {
    return null;
  }
  try {
    const value = BigInt(id);
    if (value > U32_MAX) {
      return null;
    }
    return Number(value);
  } catch {
    return null;
  }
}

export function vaultPageTitle(id: string): string {
  const vaultId = parseVaultId(id);
  return vaultId === null ? 'Vault' : `Vault ${vaultId}`;
}
