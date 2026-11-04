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
  error?: { cause?: { name?: string }; name?: string; message?: string; data?: unknown };
  result?: {
    status?: unknown;
    final_execution_status?: string;
    transaction_outcome?: { outcome?: { tokens_burnt?: string; logs?: string[] } };
    receipts_outcome?: Array<{ outcome?: { tokens_burnt?: string; logs?: string[] } }>;
  };
}

/** Milestones where every non-refund receipt, including CreateVault's MPC callback, has run. */
const SETTLED_EXECUTION = new Set(['EXECUTED_OPTIMISTIC', 'EXECUTED', 'FINAL']);
/** Refund receipts and finality. CreateVault without `vault_created` waits for one of these. */
const FULLY_SETTLED_EXECUTION = new Set(['EXECUTED', 'FINAL']);

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
function collectLogs(result: TxRpcResponse['result']): string[] {
  if (!result) return [];
  const logs: string[] = [];
  logs.push(...(result.transaction_outcome?.outcome?.logs ?? []));
  for (const receipt of result.receipts_outcome ?? []) {
    logs.push(...(receipt.outcome?.logs ?? []));
  }
  return logs;
}

function decodeSuccessValue(status: unknown): string | undefined {
  if (!status || typeof status !== 'object' || !('SuccessValue' in status)) return undefined;
  const raw = (status as { SuccessValue: unknown }).SuccessValue;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const text = Buffer.from(raw, 'base64').toString('utf8');
  if (text.startsWith('"')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return typeof parsed === 'string' ? parsed : text;
    } catch {
      return text;
    }
  }
  return text;
}

function readGuardEvents(logs: string[]): { vaultId?: number; vaultFailed: boolean } {
  let vaultId: number | undefined;
  let vaultFailed = false;
  for (const log of logs) {
    const marker = 'EVENT_JSON:';
    const idx = log.indexOf(marker);
    if (idx === -1) continue;
    try {
      const parsed = JSON.parse(log.slice(idx + marker.length)) as {
        event?: { event?: string; data?: { vault_id?: unknown } };
      };
      const name = parsed.event?.event;
      const id = parsed.event?.data?.vault_id;
      if (name === 'vault_created' && typeof id === 'number' && Number.isInteger(id)) {
        vaultId = id;
      }
      if (name === 'vault_verification_failed') {
        vaultFailed = true;
      }
    } catch {
      // A non-event log is not a settlement signal.
    }
  }
  return { vaultId, vaultFailed };
}

/**
 * Parse a `tx` / `EXPERIMENTAL_tx_status` JSON-RPC body.
 * Receipts (and their tokens_burnt) come from EXPERIMENTAL_tx_status even
 * with wait_until NONE once the tx is included.
 *
 * CreateVault's function return (`"vault N creation initiated"`) is success of the
 * first receipt only. The vault id is reliable once `vault_created` is logged by
 * `on_vault_verified`. A top-level SuccessValue before that stays pending when
 * `final_execution_status` is present and not fully settled.
 * A create payload that omits `final_execution_status` stays pending: an incomplete
 * body is not proof the callback failed, and it is not proof the vault exists.
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
  const finalExecutionStatus = json.result?.final_execution_status;
  const logs = collectLogs(json.result);
  const { vaultId, vaultFailed } = readGuardEvents(logs);
  const successText = decodeSuccessValue(status);
  const createInitiated =
    typeof successText === 'string' && /vault \d+ creation initiated/.test(successText);
  const settled = finalExecutionStatus === undefined || SETTLED_EXECUTION.has(finalExecutionStatus);
  const fullySettled =
    finalExecutionStatus !== undefined && FULLY_SETTLED_EXECUTION.has(finalExecutionStatus);

  if (vaultFailed) {
    if (!settled) {
      return { status: 'pending', tokensBurntYocto: burnt, finalExecutionStatus };
    }
    return {
      status: 'failure',
      tokensBurntYocto: burnt,
      finalExecutionStatus,
      errorMessage: 'Vault verification failed',
    };
  }

  if (vaultId !== undefined && settled) {
    return { status: 'success', tokensBurntYocto: burnt, vaultId, finalExecutionStatus };
  }

  // The initiating receipt can succeed before the MPC callback writes vault_created.
  if (createInitiated && vaultId === undefined) {
    if (!fullySettled) {
      return { status: 'pending', tokensBurntYocto: burnt, finalExecutionStatus };
    }
    return {
      status: 'failure',
      tokensBurntYocto: burnt,
      finalExecutionStatus,
      errorMessage: 'Vault verification failed',
    };
  }

  if (!settled) {
    return { status: 'pending', tokensBurntYocto: burnt, finalExecutionStatus };
  }

  if (status && typeof status === 'object') {
    if ('SuccessValue' in status || 'SuccessReceiptId' in status) {
      return { status: 'success', tokensBurntYocto: burnt, vaultId, finalExecutionStatus };
    }
    if ('Failure' in status) {
      return {
        status: 'failure',
        tokensBurntYocto: burnt,
        finalExecutionStatus,
        errorMessage: 'Transaction failed',
      };
    }
  }
  return { status: 'pending', tokensBurntYocto: burnt, finalExecutionStatus };
}
