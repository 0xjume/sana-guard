/** Second and third reads so a finality=final view can catch a tx that just settled. */
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
