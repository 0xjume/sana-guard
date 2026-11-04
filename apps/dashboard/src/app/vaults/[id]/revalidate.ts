'use server';

import { revalidatePath } from 'next/cache';

export async function revalidateVault(vaultId: number): Promise<void> {
  if (!Number.isInteger(vaultId) || vaultId < 0 || vaultId > 1_000_000_000) {
    return;
  }
  revalidatePath(`/vaults/${vaultId}`);
}
