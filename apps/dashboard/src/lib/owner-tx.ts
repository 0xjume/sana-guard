import type { RelayAdminResult } from './relay';
import { explainGuardError } from './errors';
import { readPrivyAccessToken } from './privy-browser-token';

export const OWNER_TX_POLL_INTERVAL_MS = 1_000;
export const OWNER_TX_POLL_DEADLINE_MS = 30_000;

export function interpretOwnerTxStatus(httpStatus: number, body: unknown): RelayAdminResult {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const txHash = typeof record.txHash === 'string' ? record.txHash : undefined;
  const vaultId =
    typeof record.vaultId === 'number' && Number.isInteger(record.vaultId)
      ? record.vaultId
      : undefined;

  if (txHash && record.pending === true) {
    return { success: true, pending: true, txHash, vaultId };
  }

  if (httpStatus === 200 && record.success === true && txHash) {
    return {
      success: true,
      pending: false,
      txHash,
      vaultId,
      depositYocto: typeof record.depositYocto === 'string' ? record.depositYocto : undefined,
      depositNear:
        typeof record.depositNear === 'string' || typeof record.depositNear === 'number'
          ? record.depositNear
          : undefined,
    };
  }

  const explained = explainGuardError(record);
  explained.httpStatus = httpStatus;
  if (txHash) {
    explained.txHash = txHash;
  }
  if (!explained.message) {
    explained.message = `Owner tx HTTP ${httpStatus}`;
  }
  return { success: false, error: explained };
}

export async function fetchOwnerTxStatus(args: {
  txHash: string;
  owner: string;
  fetcher?: typeof fetch;
}): Promise<RelayAdminResult> {
  const fetcher = args.fetcher ?? fetch;
  const accessToken = await readPrivyAccessToken();
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const url = `/api/owner-tx?txHash=${encodeURIComponent(args.txHash)}&owner=${encodeURIComponent(args.owner)}`;
  try {
    const response = await fetcher(url, { headers, cache: 'no-store' });
    const body = (await response.json().catch(() => ({}))) as unknown;
    return interpretOwnerTxStatus(response.status, body);
  } catch (error) {
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Transaction status unavailable',
        txHash: args.txHash,
      },
    };
  }
}

function keepPolling(result: RelayAdminResult): boolean {
  if (result.success) {
    return result.pending === true;
  }
  const status = result.error.httpStatus;
  return status === undefined || status === 429 || status === 503;
}

/**
 * Poll until the relay has seen a settled execution, or the deadline passes.
 * A deadline is not a failed broadcast: the hash stays on the error so the UI
 * can link the transaction, and the relay keeps the nonce reservation.
 */
export async function pollOwnerTxUntilSettled(args: {
  txHash: string;
  owner: string;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  deadlineMs?: number;
  intervalMs?: number;
}): Promise<RelayAdminResult> {
  const sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = args.now ?? Date.now;
  const deadline = now() + (args.deadlineMs ?? OWNER_TX_POLL_DEADLINE_MS);
  const interval = args.intervalMs ?? OWNER_TX_POLL_INTERVAL_MS;
  let latest: RelayAdminResult = {
    success: true,
    pending: true,
    txHash: args.txHash,
  };

  while (now() <= deadline) {
    latest = await fetchOwnerTxStatus({
      txHash: args.txHash,
      owner: args.owner,
      fetcher: args.fetcher,
    });
    if (!keepPolling(latest)) {
      return latest;
    }
    if (now() + interval > deadline) {
      break;
    }
    await sleep(interval);
  }

  return {
    success: false,
    error: {
      message:
        'Transaction submitted and still confirming on NEAR. It will not be sent again while this one is in flight.',
      txHash: args.txHash,
    },
  };
}
