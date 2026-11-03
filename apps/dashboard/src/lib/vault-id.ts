/** Parse a `/vaults/[id]` segment. Non-digits and negatives are not vault ids. */
export function parseVaultId(id: string): number | null {
  if (!/^\d+$/.test(id)) {
    return null;
  }
  const vaultId = Number(id);
  if (!Number.isInteger(vaultId) || vaultId < 0) {
    return null;
  }
  return vaultId;
}
