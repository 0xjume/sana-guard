import type { TxStatusResult } from './interface.js';

export function sumTokensBurnt(outcome: {
  transaction_outcome?: { outcome?: { tokens_burnt?: string } };
  receipts_outcome?: Array<{ outcome?: { tokens_burnt?: string } }>;
}): string {
  let total = 0n;
  const txBurnt = outcome.transaction_outcome?.outcome?.tokens_burnt;
  if (txBurnt) total += BigInt(txBurnt);
  for (const receipt of outcome.receipts_outcome ?? []) {
    const burnt = receipt.outcome?.tokens_burnt;
    if (burnt) total += BigInt(burnt);
  }
  return total.toString();
}

export interface TxRpcResponse {
  error?: { cause?: { name?: string }; name?: string; message?: string };
  result?: {
    status?: unknown;
    transaction_outcome?: { outcome?: { tokens_burnt?: string } };
    receipts_outcome?: Array<{ outcome?: { tokens_burnt?: string } }>;
  };
}

export function isUnknownTransaction(error: TxRpcResponse['error']): boolean {
  if (!error) return false;
  const name = `${error.cause?.name ?? ''} ${error.name ?? ''} ${error.message ?? ''}`;
  return /UNKNOWN_TRANSACTION|UNKNOWN_TX|DoesNotExist/i.test(name);
}

/**
 * Parse a `tx` / `EXPERIMENTAL_tx_status` JSON-RPC body.
 * Receipts (and their tokens_burnt) come from EXPERIMENTAL_tx_status even
 * with wait_until NONE once the tx is included.
 */
export function parseTxStatusJson(json: TxRpcResponse): TxStatusResult {
  if (json.error) {
    if (isUnknownTransaction(json.error)) {
      return { status: 'unknown' };
    }
    return { status: 'pending' };
  }

  const status = json.result?.status;
  const burnt = json.result ? sumTokensBurnt(json.result) : undefined;
  if (status && typeof status === 'object') {
    if ('SuccessValue' in status || 'SuccessReceiptId' in status) {
      return { status: 'success', tokensBurntYocto: burnt };
    }
    if ('Failure' in status) {
      return { status: 'failure', tokensBurntYocto: burnt };
    }
  }
  return { status: 'pending' };
}
