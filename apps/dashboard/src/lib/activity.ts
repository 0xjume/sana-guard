export type ActivityKind =
  | 'sign_requested'
  | 'sign_rejected'
  | 'signed'
  | 'sign_failed'
  | 'released'
  | 'paused'
  | 'unpaused'
  | 'policy_changed'
  | 'policy_loosen_scheduled'
  | 'agent_added'
  | 'agent_removed'
  | 'vault_created'
  | 'failed_receipt'
  | 'other';

export interface ActivityItem {
  kind: ActivityKind;
  title: string;
  detail?: string;
  vaultId?: number;
  reqId?: string;
  txHash?: string;
  timestampMs?: number;
  code?: string;
}

interface NearblocksTxn {
  transaction_hash?: string;
  tx_hash?: string;
  block_timestamp?: number | string;
  outcomes?: { status?: boolean };
  logs?: string[];
  receipts?: Array<{ logs?: string[]; outcome?: { logs?: string[]; status?: unknown } }>;
  outcomes_agg?: { transaction_status?: string };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function flattenLogs(txn: NearblocksTxn): string[] {
  const logs: string[] = [];
  if (Array.isArray(txn.logs)) {
    logs.push(...txn.logs);
  }
  for (const receipt of txn.receipts ?? []) {
    if (Array.isArray(receipt.logs)) {
      logs.push(...receipt.logs);
    }
    if (Array.isArray(receipt.outcome?.logs)) {
      logs.push(...receipt.outcome.logs);
    }
  }
  return logs;
}

function eventKind(name: string): ActivityKind {
  switch (name) {
    case 'sign_requested':
    case 'sign_rejected':
    case 'signed':
    case 'sign_failed':
    case 'released':
    case 'paused':
    case 'unpaused':
    case 'policy_changed':
    case 'policy_loosen_scheduled':
    case 'agent_added':
    case 'agent_removed':
    case 'vault_created':
      return name;
    default:
      return 'other';
  }
}

function titleFor(kind: ActivityKind, code?: string): string {
  switch (kind) {
    case 'sign_requested':
      return 'Sign requested';
    case 'sign_rejected':
      return code ? `Rejected (${code})` : 'Sign rejected';
    case 'signed':
      return 'Signed';
    case 'sign_failed':
      return 'MPC sign failed';
    case 'released':
      return 'Reservation released';
    case 'paused':
      return 'Vault paused';
    case 'unpaused':
      return 'Vault unpaused';
    case 'policy_changed':
      return 'Policy updated';
    case 'policy_loosen_scheduled':
      return 'Policy loosen scheduled';
    case 'agent_added':
      return 'Agent added';
    case 'agent_removed':
      return 'Agent removed';
    case 'vault_created':
      return 'Vault created';
    case 'failed_receipt':
      return code ? `Request failed (${code})` : 'Request failed';
    default:
      return 'Contract event';
  }
}

export function parseEventJsonLog(log: string): ActivityItem | null {
  const marker = 'EVENT_JSON:';
  const index = log.indexOf(marker);
  if (index === -1) {
    const codeMatch = log.match(/SG_E\d{3}_[A-Z0-9_]+/);
    if (!codeMatch) {
      return null;
    }
    return {
      kind: 'failed_receipt',
      title: titleFor('failed_receipt', codeMatch[0]),
      detail: log.trim(),
      code: codeMatch[0],
    };
  }

  try {
    const parsed = JSON.parse(log.slice(index + marker.length)) as unknown;
    const root = asRecord(parsed);
    if (!root) {
      return null;
    }
    const inner = asRecord(root.event) ?? root;
    const name =
      typeof inner.event === 'string'
        ? inner.event
        : typeof root.event === 'string'
          ? root.event
          : '';
    const data = asRecord(inner.data) ?? inner;
    const vaultId =
      typeof data.vault_id === 'number'
        ? data.vault_id
        : typeof data.vault_id === 'string'
          ? Number(data.vault_id)
          : undefined;
    const reqId = typeof data.req_id === 'string' ? data.req_id : undefined;
    const reason = typeof data.reason === 'string' ? data.reason : undefined;
    const code = reason?.match(/SG_E\d{3}_[A-Z0-9_]+/)?.[0];
    const kind = eventKind(name);
    return {
      kind,
      title: titleFor(kind, code),
      detail: reason ?? (typeof data.agent === 'string' ? data.agent : undefined),
      vaultId: Number.isFinite(vaultId) ? vaultId : undefined,
      reqId,
      code,
    };
  } catch {
    return null;
  }
}

export function parseNearblocksTransactions(
  txns: NearblocksTxn[],
  vaultId?: number
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const txn of txns) {
    const txHash = txn.transaction_hash ?? txn.tx_hash;
    const timestampMs =
      typeof txn.block_timestamp === 'number'
        ? txn.block_timestamp > 1e12
          ? txn.block_timestamp
          : txn.block_timestamp * 1000
        : typeof txn.block_timestamp === 'string'
          ? Number(txn.block_timestamp)
          : undefined;
    for (const log of flattenLogs(txn)) {
      const item = parseEventJsonLog(log);
      if (!item) {
        continue;
      }
      if (vaultId !== undefined && item.vaultId !== undefined && item.vaultId !== vaultId) {
        continue;
      }
      items.push({
        ...item,
        txHash,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : undefined,
      });
    }
  }
  return items;
}

export function activityFromTxns(
  txns: NearblocksTxn[],
  vaultId?: number
): { items: ActivityItem[]; source: string; degraded: boolean; reason?: string } {
  if (txns.length === 0) {
    return {
      items: [],
      source: 'nearblocks',
      degraded: true,
      reason: 'no history source',
    };
  }
  return {
    items: parseNearblocksTransactions(txns, vaultId).slice(0, 40),
    source: 'nearblocks',
    degraded: false,
  };
}

export async function fetchVaultActivity(args: {
  accountId: string;
  vaultId?: number;
  network?: 'testnet' | 'mainnet';
}): Promise<{ items: ActivityItem[]; source: string; degraded: boolean; reason?: string }> {
  const host =
    args.network === 'mainnet' ? 'https://api.nearblocks.io' : 'https://api-testnet.nearblocks.io';
  const url = `${host}/v1/account/${args.accountId}/txns?per_page=25&order=desc`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 15 },
    });
    if (!response.ok) {
      return {
        items: [],
        source: 'nearblocks',
        degraded: true,
        reason: `Indexer HTTP ${response.status}`,
      };
    }
    const body = (await response.json()) as { txns?: NearblocksTxn[]; data?: NearblocksTxn[] };
    const txns = body.txns ?? body.data ?? [];
    return activityFromTxns(txns, args.vaultId);
  } catch (error) {
    return {
      items: [],
      source: 'nearblocks',
      degraded: true,
      reason: error instanceof Error ? error.message : 'Indexer unavailable',
    };
  }
}
