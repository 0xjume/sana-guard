import { logger } from './logger.js';
import type { RelayDatabase, UnknownReservation } from './db.js';
import type { NearClient, TxStatusResult } from './near/interface.js';

/** NEAR signed txs expire once their reference block is too old (~1 day). */
export const TX_VALIDITY_MS = 24 * 60 * 60 * 1000;

export function createUnknownResolver(db: RelayDatabase, nearClient: NearClient) {
  let running = false;

  return async function resolveOnce(): Promise<number> {
    if (running) return 0;
    running = true;
    try {
      return await db.resolveUnknownReservations({
        checkTx: (txHash) => nearClient.getTransactionStatus(txHash),
        checkOwnerNonce: (owner) => nearClient.getOwnerNonce(owner),
        nowMs: Date.now(),
        txValidityMs: TX_VALIDITY_MS,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to resolve unknown reservations');
      return 0;
    } finally {
      running = false;
    }
  };
}

export function spentAfterOutcome(args: {
  depositYocto: string;
  tokensBurntYocto?: string;
  success: boolean;
}): string {
  const burnt = args.tokensBurntYocto ? BigInt(args.tokensBurntYocto) : 0n;
  if (args.success) {
    return (BigInt(args.depositYocto) + burnt).toString();
  }
  return burnt.toString();
}

export type { UnknownReservation, TxStatusResult };
