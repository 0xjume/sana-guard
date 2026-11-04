import { logger } from '../logger.js';

/**
 * rpc.testnet.near.org answered query/block in ~3.2s on 2026-11-04.
 * A shorter deadline treats that hang as a miss so the process can stick
 * to one faster endpoint instead of paying the delay on every call.
 * near-api-js retries a Timeout body up to 12 times; this caller does not.
 */
export const PREPARE_RPC_TIMEOUT_MS = 1_500;

export interface NearRpcTiming {
  step: string;
  ms: number;
  endpoint: 'primary' | 'fallback';
  outcome: 'ok' | 'timeout' | 'error';
}

export interface NearRpc {
  /** Parsed `result`. Throws on a JSON-RPC error or when every endpoint fails. */
  call(method: string, params: unknown, step: string, timeoutMs?: number): Promise<unknown>;
  /**
   * Full JSON-RPC body. `null` when every endpoint failed at the transport.
   * A non-timeout JSON-RPC error is returned as-is and is not sent to the fallback.
   */
  request(
    method: string,
    params: unknown,
    step: string,
    timeoutMs?: number
  ): Promise<RpcResponse | null>;
  /** Endpoint the next single-shot broadcast should use. No second attempt. */
  preferredUrl(): string;
}

export interface RpcResponse {
  error?: { message?: unknown; data?: unknown; cause?: { name?: unknown } };
  result?: unknown;
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Fallback only for the public NEAR endpoints whose steady latency is several seconds. */
export function publicRpcFallback(primaryUrl: string): string | null {
  const host = hostname(primaryUrl);
  if (host === 'rpc.testnet.near.org' || host === 'archival-rpc.testnet.near.org') {
    return 'https://test.rpc.fastnear.com';
  }
  if (host === 'rpc.mainnet.near.org' || host === 'archival-rpc.mainnet.near.org') {
    return 'https://rpc.mainnet.fastnear.com';
  }
  return null;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String(error.name) : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

function isRpcTimeoutBody(body: RpcResponse): boolean {
  const error = body.error;
  if (!error) return false;
  const data = typeof error.data === 'string' ? error.data : '';
  const message = typeof error.message === 'string' ? error.message : '';
  const cause = error.cause?.name ?? '';
  return /timeout|timed out/i.test(`${message} ${data} ${cause}`);
}

function transportStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createNearRpc(args: {
  primaryUrl: string;
  fallbackUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onTiming?: (event: NearRpcTiming) => void;
}): NearRpc {
  const fallbackUrl =
    args.fallbackUrl === undefined ? publicRpcFallback(args.primaryUrl) : args.fallbackUrl;
  const timeoutMs = args.timeoutMs ?? PREPARE_RPC_TIMEOUT_MS;
  const fetchImpl = args.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = args.now ?? Date.now;
  const onTiming = args.onTiming ?? ((event) => logger.info(event, 'near rpc'));
  let preferFallback = false;

  async function once(
    url: string,
    endpoint: 'primary' | 'fallback',
    method: string,
    params: unknown,
    step: string,
    budgetMs: number
  ): Promise<{ ok: true; body: RpcResponse } | { ok: false; retry: boolean }> {
    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'relay', method, params }),
        signal: controller.signal,
      });
      if (transportStatus(response.status)) {
        onTiming({ step, ms: now() - started, endpoint, outcome: 'timeout' });
        return { ok: false, retry: true };
      }
      const body = (await response.json().catch(() => null)) as RpcResponse | null;
      if (!body || typeof body !== 'object') {
        onTiming({ step, ms: now() - started, endpoint, outcome: 'error' });
        return { ok: false, retry: true };
      }
      if (isRpcTimeoutBody(body)) {
        onTiming({ step, ms: now() - started, endpoint, outcome: 'timeout' });
        return { ok: false, retry: true };
      }
      onTiming({
        step,
        ms: now() - started,
        endpoint,
        outcome: body.error ? 'error' : 'ok',
      });
      return { ok: true, body };
    } catch (error) {
      onTiming({
        step,
        ms: now() - started,
        endpoint,
        outcome: isTimeoutError(error) ? 'timeout' : 'error',
      });
      return { ok: false, retry: true };
    } finally {
      clearTimeout(timer);
    }
  }

  const rpc: NearRpc = {
    preferredUrl() {
      if (preferFallback && fallbackUrl) return fallbackUrl;
      return args.primaryUrl;
    },
    async request(method, params, step, budgetMs = timeoutMs) {
      const order: Array<'primary' | 'fallback'> =
        preferFallback && fallbackUrl ? ['fallback', 'primary'] : ['primary', 'fallback'];
      for (const endpoint of order) {
        const url = endpoint === 'primary' ? args.primaryUrl : fallbackUrl;
        if (!url) continue;
        if (endpoint === 'fallback' && url === args.primaryUrl) continue;
        const attempt = await once(url, endpoint, method, params, step, budgetMs);
        if (!attempt.ok) continue;
        if (endpoint === 'fallback') preferFallback = true;
        if (endpoint === 'primary') preferFallback = false;
        return attempt.body;
      }
      return null;
    },
    async call(method, params, step, budgetMs) {
      const body = await rpc.request(method, params, step, budgetMs);
      if (!body || body.error || body.result === undefined) {
        throw new Error('NEAR RPC error');
      }
      return body.result;
    },
  };
  return rpc;
}
