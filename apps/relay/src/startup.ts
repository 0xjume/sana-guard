import type { RelayDatabase } from './db.js';

/**
 * Convert leftover `pending` rows to `unknown` before the server listens.
 * A process that just started cannot still be submitting those rows; the
 * existing unknown resolver then settles or releases them.
 */
export function recoverOrphanedReservations(db: RelayDatabase): number {
  return db.promotePendingToUnknown();
}
