/** Stages shown after the owner approves the review dialog. */
export type OwnerSignProgress = { phase: 'submitting' } | { phase: 'confirming'; txHash: string };

type Listener = (progress: OwnerSignProgress | null) => void;

let listener: Listener | null = null;

export function bindOwnerSignProgress(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) {
      listener = null;
    }
  };
}

export function reportOwnerSignProgress(progress: OwnerSignProgress | null): void {
  listener?.(progress);
}

export function signDialogButtonLabel(progress: OwnerSignProgress | null): string {
  if (progress?.phase === 'confirming') return 'Confirming on NEAR…';
  if (progress?.phase === 'submitting') return 'Submitting…';
  return 'Sign with wallet';
}

export function createVaultButtonLabel(progress: OwnerSignProgress | null, busy: boolean): string {
  if (progress?.phase === 'confirming') return 'Confirming on NEAR…';
  if (progress?.phase === 'submitting') return 'Submitting…';
  if (busy) return 'Preparing…';
  return 'Create vault';
}

export function vaultCreatedMessage(vaultId: number | undefined): string {
  return vaultId === undefined ? 'Vault created.' : `Vault ${vaultId} created.`;
}
