import { Account as NearAccount } from 'near-api-js';
import { Views, parseJsonIntegersAsStrings, type Policy, type VaultView } from '@sana-guard/sdk';
import { publicConfig } from './config';

interface NearRpcError {
  message?: string;
}

interface NearRpcResponse {
  result?: {
    result?: number[] | string;
    error?: string;
  };
  error?: NearRpcError;
}

export async function callNearViewRaw(
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  rpcUrl: string = publicConfig.nearRpcUrl
): Promise<string> {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'sana-guard-dashboard',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'optimistic',
        account_id: contractId,
        method_name: methodName,
        args_base64: argsBase64,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`NEAR RPC HTTP ${response.status}`);
  }

  const body = (await response.json()) as NearRpcResponse;
  if (body.error?.message) {
    throw new Error(body.error.message);
  }
  if (body.result?.error) {
    throw new Error(body.result.error);
  }

  const raw = body.result?.result;
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
  rpcUrl: string = publicConfig.nearRpcUrl
): Views {
  const viewFunction = async (opts: {
    contractId: string;
    methodName: string;
    args?: Record<string, unknown>;
    parse?: (bytes: Uint8Array) => unknown;
  }) => {
    const text = await callNearViewRaw(opts.contractId, opts.methodName, opts.args ?? {}, rpcUrl);
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
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBalance',
      params: [address],
    }),
  });
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
