import { PublicKey } from '@solana/web3.js';
import type { Mint, Policy, VaultView } from '@sana-guard/sdk';
import { createViews, getSolanaBalanceLamports } from './near';

export type VaultSnapshotStatus = 'ok' | 'not_found' | 'error';

export interface VaultSnapshotViews {
  getVault: (vaultId: number) => Promise<VaultView | null>;
  getRecipients: (vaultId: number) => Promise<string[]>;
  getSpend24h: (vaultId: number) => Promise<Array<{ mint: string; amount: bigint }>>;
}

export interface VaultSnapshot {
  vaultId: number;
  status: VaultSnapshotStatus;
  error?: string;
  vault?: VaultView;
  recipients?: string[];
  spend?: Array<{ mint: string; amount: bigint }>;
  balance?: bigint | null;
}

type SerializedMint = { type: 'sol' } | { type: 'spl'; address: string };

interface SerializedPolicy {
  perTxLimit: Array<{ mint: SerializedMint; amount: string }>;
  dailyCap: Array<{ mint: SerializedMint; amount: string }>;
  programs: string[];
  maxPriorityFeeLamports: string;
  maxTotalPriorityFeeLamports?: string;
  maxMemoLen: number;
  expiresAtNs: string;
  loosenDelayNs: string;
}

interface SerializedVaultView {
  owner: string;
  vaultAddress: string;
  path: string;
  agents: string[];
  policy: SerializedPolicy;
  pendingLoosen?: {
    policy: SerializedPolicy;
    effectiveNs: string;
  };
  paused: boolean;
  state: VaultView['state'];
}

export interface SerializedVaultSnapshot {
  vaultId: number;
  status: VaultSnapshotStatus;
  error?: string;
  vault?: SerializedVaultView;
  recipients: string[];
  spend: Array<{ mint: string; amount: string }>;
  balance: string | null;
}

function serializeMint(mint: Mint): SerializedMint {
  return mint.type === 'sol' ? { type: 'sol' } : { type: 'spl', address: mint.address.toBase58() };
}

function deserializeMint(mint: SerializedMint): Mint {
  return mint.type === 'sol'
    ? { type: 'sol' }
    : { type: 'spl', address: new PublicKey(mint.address) };
}

function serializePolicy(policy: Policy): SerializedPolicy {
  return {
    perTxLimit: policy.perTxLimit.map((item) => ({
      mint: serializeMint(item.mint),
      amount: item.amount.toString(),
    })),
    dailyCap: policy.dailyCap.map((item) => ({
      mint: serializeMint(item.mint),
      amount: item.amount.toString(),
    })),
    programs: policy.programs,
    maxPriorityFeeLamports: policy.maxPriorityFeeLamports.toString(),
    maxTotalPriorityFeeLamports: policy.maxTotalPriorityFeeLamports?.toString(),
    maxMemoLen: policy.maxMemoLen,
    expiresAtNs: policy.expiresAtNs.toString(),
    loosenDelayNs: policy.loosenDelayNs.toString(),
  };
}

function deserializePolicy(policy: SerializedPolicy): Policy {
  return {
    perTxLimit: policy.perTxLimit.map((item) => ({
      mint: deserializeMint(item.mint),
      amount: BigInt(item.amount),
    })),
    dailyCap: policy.dailyCap.map((item) => ({
      mint: deserializeMint(item.mint),
      amount: BigInt(item.amount),
    })),
    programs: policy.programs,
    maxPriorityFeeLamports: BigInt(policy.maxPriorityFeeLamports),
    maxTotalPriorityFeeLamports:
      policy.maxTotalPriorityFeeLamports === undefined
        ? undefined
        : BigInt(policy.maxTotalPriorityFeeLamports),
    maxMemoLen: policy.maxMemoLen,
    expiresAtNs: BigInt(policy.expiresAtNs),
    loosenDelayNs: BigInt(policy.loosenDelayNs),
  };
}

function serializeVault(vault: VaultView): SerializedVaultView {
  return {
    owner: vault.owner,
    vaultAddress: vault.vaultAddress,
    path: vault.path,
    agents: vault.agents,
    policy: serializePolicy(vault.policy),
    pendingLoosen: vault.pendingLoosen
      ? {
          policy: serializePolicy(vault.pendingLoosen.policy),
          effectiveNs: vault.pendingLoosen.effectiveNs.toString(),
        }
      : undefined,
    paused: vault.paused,
    state: vault.state,
  };
}

function deserializeVault(vault: SerializedVaultView): VaultView {
  return {
    owner: vault.owner,
    vaultAddress: vault.vaultAddress,
    path: vault.path,
    agents: vault.agents,
    policy: deserializePolicy(vault.policy),
    pendingLoosen: vault.pendingLoosen
      ? {
          policy: deserializePolicy(vault.pendingLoosen.policy),
          effectiveNs: BigInt(vault.pendingLoosen.effectiveNs),
        }
      : undefined,
    paused: vault.paused,
    state: vault.state,
  };
}

export function serializeVaultSnapshot(snapshot: VaultSnapshot): SerializedVaultSnapshot {
  return {
    vaultId: snapshot.vaultId,
    status: snapshot.status,
    error: snapshot.error,
    vault: snapshot.vault ? serializeVault(snapshot.vault) : undefined,
    recipients: snapshot.recipients ?? [],
    spend: (snapshot.spend ?? []).map((item) => ({
      mint: item.mint,
      amount: item.amount.toString(),
    })),
    balance: snapshot.balance == null ? null : snapshot.balance.toString(),
  };
}

export function deserializeVaultSnapshot(snapshot: SerializedVaultSnapshot): VaultSnapshot {
  return {
    vaultId: snapshot.vaultId,
    status: snapshot.status,
    error: snapshot.error,
    vault: snapshot.vault ? deserializeVault(snapshot.vault) : undefined,
    recipients: snapshot.recipients,
    spend: snapshot.spend.map((item) => ({ mint: item.mint, amount: BigInt(item.amount) })),
    balance: snapshot.balance === null ? null : BigInt(snapshot.balance),
  };
}

/**
 * Initial vault/policy/agents/spend/balance read. Used by the vault RSC so first
 * paint has data. Client refresh uses the same helper without Next.js caching.
 */
export async function loadVaultSnapshot(
  vaultId: number,
  options: {
    revalidate?: number;
    views?: VaultSnapshotViews;
    getBalance?: (address: string) => Promise<bigint>;
  } = {}
): Promise<VaultSnapshot> {
  const views =
    options.views ?? createViews(undefined, undefined, { revalidate: options.revalidate });
  const getBalance =
    options.getBalance ??
    ((address: string) =>
      getSolanaBalanceLamports(address, undefined, { revalidate: options.revalidate }));

  const vaultPromise = views.getVault(vaultId);
  const detailsPromise = Promise.all([views.getRecipients(vaultId), views.getSpend24h(vaultId)]);

  let vault: VaultView | null;
  try {
    vault = await vaultPromise;
  } catch (error) {
    void detailsPromise.catch(() => undefined);
    return {
      vaultId,
      status: 'error',
      error: error instanceof Error ? error.message : 'Failed to load vault',
    };
  }

  if (!vault) {
    void detailsPromise.catch(() => undefined);
    return { vaultId, status: 'not_found' };
  }

  let recipients: string[] = [];
  let spend: Array<{ mint: string; amount: bigint }> = [];
  try {
    [recipients, spend] = await detailsPromise;
  } catch {
    // Vault identity loaded; allowlists and spend can stay empty until retry.
  }

  let balance: bigint | null = null;
  try {
    balance = await getBalance(vault.vaultAddress);
  } catch {
    balance = null;
  }

  return {
    vaultId,
    status: 'ok',
    vault,
    recipients,
    spend,
    balance,
  };
}
