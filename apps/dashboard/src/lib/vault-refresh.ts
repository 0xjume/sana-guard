/**
 * Client re-reads so a finality=final view can catch a tx that just settled.
 * The vault page is force-dynamic and VaultDetail ignores later server props,
 * so this does not revalidate the RSC.
 */
export const VAULT_FOLLOW_UP_REFRESH_MS = [2_000, 4_000] as const;

export function planVaultRefresh(
  now: () => void,
  schedule: (ms: number, run: () => void) => void
): void {
  now();
  for (const ms of VAULT_FOLLOW_UP_REFRESH_MS) {
    schedule(ms, now);
  }
}
