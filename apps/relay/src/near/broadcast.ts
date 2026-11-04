import { logger } from '../logger.js';

/**
 * Broadcast a signed transaction without near-api-js's long poll.
 *
 * `provider.sendTransaction` calls `send_tx` with `wait_until: EXECUTED_OPTIMISTIC`
 * and retries Timeout / HTTP 408 up to 12 × 10 times. On rpc.testnet.near.org that
 * holds the HTTP request for minutes even when the chain finished in a couple of
 * seconds (CreateVault's `derived_public_key` callback is one local receipt, not
 * an MPC signature). One `send_tx` with `wait_until: NONE` returns the acceptance
 * result; callers poll `EXPERIMENTAL_tx_status` with `wait_until: NONE`.
 */

const BROADCAST_TIMEOUT_MS = 15_000;

export interface BroadcastRequest {
  rpcUrl: string;
  signedTxBase64: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function broadcastTxBody(signedTxBase64: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 'relay-send-tx',
    method: 'send_tx',
    params: {
      signed_tx_base64: signedTxBase64,
      wait_until: 'NONE',
    },
  });
}

function rejectionType(payload: unknown): 'InvalidNonce' | 'InvalidTransaction' | undefined {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
  if (/InvalidNonce/i.test(text)) return 'InvalidNonce';
  if (/InvalidTransaction|InvalidTxError/i.test(text)) return 'InvalidTransaction';
  return undefined;
}

function throwRejected(kind: 'InvalidNonce' | 'InvalidTransaction'): never {
  const error = new Error('Transaction rejected before acceptance') as Error & { type: string };
  error.type = kind;
  throw error;
}

/** Name/code only. RPC message and data stay off the client and out of this string. */
export function broadcastRpcErrorType(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown';
  const record = error as { name?: unknown; code?: unknown; cause?: { name?: unknown } };
  const cause = typeof record.cause?.name === 'string' ? record.cause.name : '';
  const name = typeof record.name === 'string' ? record.name : '';
  const code =
    typeof record.code === 'number' || typeof record.code === 'string' ? String(record.code) : '';
  return [cause, name, code].filter(Boolean).join('/') || 'unknown';
}

function throwBroadcastTimeout(error: unknown): never {
  logger.warn({ rpcErrorType: broadcastRpcErrorType(error) }, 'NEAR broadcast treated as timeout');
  throw new Error('NEAR broadcast timed out');
}

export function interpretBroadcastResponse(payload: unknown): void {
  if (!payload || typeof payload !== 'object') {
    throw new Error('NEAR broadcast timed out');
  }
  const body = payload as {
    error?: { message?: unknown; data?: unknown; cause?: { name?: unknown } };
    result?: unknown;
  };
  if (body.error) {
    const kind = rejectionType(body.error);
    if (kind) throwRejected(kind);
    throwBroadcastTimeout(body.error);
  }
  if (body.result === undefined) {
    throw new Error('NEAR broadcast timed out');
  }
}

/**
 * Single attempt. A gateway 408 or an abort must not be retried: the signed
 * transaction may already be in the mempool, and a retry restarts the long wait.
 */
export async function broadcastSignedTransaction(args: BroadcastRequest): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? BROADCAST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(args.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: broadcastTxBody(args.signedTxBase64),
        signal: controller.signal,
      });
    } catch {
      throw new Error('NEAR broadcast timed out');
    }
    if (response.status === 408 || response.status === 504) {
      throw new Error('NEAR broadcast timed out');
    }
    const json = (await response.json().catch(() => null)) as unknown;
    if (!response.ok && !json) {
      throw new Error('NEAR broadcast timed out');
    }
    interpretBroadcastResponse(json);
  } finally {
    clearTimeout(timer);
  }
}
