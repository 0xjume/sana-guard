import { Account as NearAccount } from 'near-api-js';
import { Views, parseJsonIntegersAsStrings, type Policy, type VaultView } from '@sana-guard/sdk';
import { publicConfig } from './config';
import { fetchWithTimeout, RequestTimeoutError } from './fetch-timeout';

interface NearRpcError {
  message?: string;
  data?: unknown;
}

interface NearRpcResponse {
  result?: {
    result?: number[] | string;
    error?: string;
  };
  error?: NearRpcError;
}

/** Painted vault state. Optimistic tips differ across nodes behind one public URL. */
export type NearFinality = 'final' | 'optimistic';
export const DISPLAY_FINALITY: NearFinality = 'final';

/**
 * One attempt. The public testnet endpoint is healthy around 3s; past this it
 * is down, and the rest of this page read uses the fallback.
 */
const VIEW_ATTEMPT_MS = 4_000;

export function fallbackRpcUrl(primaryUrl: string): string | null {
  let host = '';
  try {
    host = new URL(primaryUrl).hostname;
  } catch {
    return null;
  }
  if (host === 'rpc.testnet.near.org' || host === 'archival-rpc.testnet.near.org') {
    return 'https://test.rpc.fastnear.com';
  }
  if (host === 'rpc.mainnet.near.org' || host === 'archival-rpc.mainnet.near.org') {
    return 'https://rpc.mainnet.fastnear.com';
  }
  return null;
}

export interface ViewRpc {
  post(body: string): Promise<unknown>;
  chosenUrl(): string;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) {
    return false;
  }
  const name = String(error.name);
  return name === 'TimeoutError' || name === 'AbortError' || name === 'RequestTimeoutError';
}

function httpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const match = /HTTP (\d+)/.exec(error.message);
  return match ? Number(match[1]) : undefined;
}

function canFailOver(error: unknown): boolean {
  if (isTimeoutError(error)) {
    return true;
  }
  const status = httpStatus(error);
  return status === 408 || status === 429 || (status !== undefined && status >= 500);
}

function isRpcTimeoutBody(body: NearRpcResponse): boolean {
  const data = typeof body.error?.data === 'string' ? body.error.data : '';
  const message = body.error?.message ?? '';
  return /timeout|timed out/i.test(`${message} ${data}`);
}

export function createViewRpc(
  primaryUrl: string,
  options: {
    fallbackUrl?: string | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {}
): ViewRpc {
  const fallback =
    options.fallbackUrl === undefined ? fallbackRpcUrl(primaryUrl) : options.fallbackUrl;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? VIEW_ATTEMPT_MS;
  let url = primaryUrl;
  let failedOver = false;

  async function postOnce(target: string, body: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new RequestTimeoutError('NEAR testnet RPC', timeoutMs);
      }
      throw error;
    }
    if (!response.ok) {
      throw new Error(`NEAR RPC HTTP ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }

  return {
    chosenUrl: () => url,
    async post(body: string): Promise<unknown> {
      try {
        const parsed = (await postOnce(url, body)) as NearRpcResponse;
        if (
          parsed.error &&
          isRpcTimeoutBody(parsed) &&
          !failedOver &&
          fallback &&
          fallback !== url
        ) {
          failedOver = true;
          url = fallback;
          return postOnce(url, body);
        }
        return parsed;
      } catch (error) {
        if (!canFailOver(error) || failedOver || !fallback || fallback === url) {
          throw error;
        }
        failedOver = true;
        url = fallback;
        return postOnce(url, body);
      }
    },
  };
}

export function nearViewQueryBody(
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  finality: NearFinality
): string {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 'sana-guard-dashboard',
    method: 'query',
    params: {
      request_type: 'call_function',
      finality,
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    },
  });
}

export async function callNearViewRaw(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  rpc: ViewRpc = createViewRpc(publicConfig.nearRpcUrl),
  finality: NearFinality = DISPLAY_FINALITY
): Promise<string> {
  const parsed = (await rpc.post(
    nearViewQueryBody(contractId, methodName, args, finality)
  )) as NearRpcResponse;
  if (parsed.error?.message && !isRpcTimeoutBody(parsed)) {
    throw new Error(parsed.error.message);
  }
  if (parsed.error) {
    throw new Error('NEAR RPC error');
  }
  if (parsed.result?.error) {
    throw new Error(parsed.result.error);
  }

  const raw = parsed.result?.result;
  if (typeof raw === 'string') {
    return Buffer.from(raw, 'base64').toString('utf8');
  }
  if (Array.isArray(raw)) {
    return Buffer.from(raw).toString('utf8');
  }
  throw new Error(`Empty view result for ${methodName}`);
}

export function createViews(
  guardContract: string = publicConfig.guardContract,
  rpcUrl: string = publicConfig.nearRpcUrl,
  options: { finality?: NearFinality } = {}
): Views {
  const finality = options.finality ?? DISPLAY_FINALITY;
  const rpc = createViewRpc(rpcUrl);
  const viewFunction = async (opts: {
    contractId: string;
    methodName: string;
    args?: Record<string, unknown>;
    parse?: (bytes: Uint8Array) => unknown;
  }) => {
    const text = await callNearViewRaw(
      opts.contractId,
      opts.methodName,
      opts.args ?? {},
      rpc,
      finality
    );
    if (opts.parse) {
      return opts.parse(Buffer.from(text, 'utf8'));
    }
    return parseJsonIntegersAsStrings(text);
  };

  return new Views({ viewFunction } as unknown as NearAccount, guardContract);
}

export interface OwnerVaultEntry {
  id: number;
  vault: VaultView;
}

export async function listOwnerVaults(
  ownerB58: string,
  views: Views = createViews()
): Promise<{ count: number; vaults: OwnerVaultEntry[] }> {
  const count = await views.getOwnerVaultCount(ownerB58);
  if (count === 0) {
    return { count, vaults: [] };
  }

  const vaults: OwnerVaultEntry[] = [];
  let from = 0;
  const pageSize = 50;

  while (vaults.length < count) {
    const page = await views.listVaults(from, pageSize);
    if (page.length === 0) {
      break;
    }
    for (const entry of page) {
      if (entry.vault.owner === ownerB58) {
        vaults.push(entry);
      }
    }
    from += page.length;
    if (page.length < pageSize) {
      break;
    }
  }

  return { count, vaults };
}

export async function getSolanaBalanceLamports(
  address: string,
  rpcUrl: string = publicConfig.solanaRpcUrl
): Promise<bigint> {
  const response = await fetchWithTimeout(
    rpcUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
      cache: 'no-store',
    },
    'Solana RPC'
  );
  if (!response.ok) {
    throw new Error(`Solana RPC HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    result?: { value?: number };
    error?: { message?: string };
  };
  if (body.error?.message) {
    throw new Error(body.error.message);
  }
  if (typeof body.result?.value !== 'number') {
    throw new Error('Solana balance missing');
  }
  return BigInt(body.result.value);
}

export function clonePolicy(policy: Policy): Policy {
  return {
    perTxLimit: policy.perTxLimit.map((item) => ({ ...item })),
    dailyCap: policy.dailyCap.map((item) => ({ ...item })),
    programs: [...policy.programs],
    maxPriorityFeeLamports: policy.maxPriorityFeeLamports,
    maxTotalPriorityFeeLamports: policy.maxTotalPriorityFeeLamports,
    maxMemoLen: policy.maxMemoLen,
    expiresAtNs: policy.expiresAtNs,
    loosenDelayNs: policy.loosenDelayNs,
  };
}
