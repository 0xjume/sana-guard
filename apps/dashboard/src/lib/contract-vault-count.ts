/**
 * Vaults currently stored on the guard. `list_vaults` returns one entry per
 * live vault (including id 0), so the count is the list length.
 * `next_vault_id - 1` is the highest id only when no vault was removed.
 */
export function countContractVaults(vaults: readonly unknown[]): number {
  return vaults.length;
}

/** `list_vaults` caps a page at 100. A full page means later entries were not included. */
export function vaultListHasMore(pageLength: number, pageSize: number): boolean {
  return pageLength >= pageSize;
}
