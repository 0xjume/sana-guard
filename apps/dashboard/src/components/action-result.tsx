'use client';

import { nearExplorerTxUrl, publicConfig } from '@/lib/config';
import { formatActionError, type GuardActionError } from '@/lib/errors';

export function ActionResult({
  error,
  txHash,
  success,
}: {
  error?: GuardActionError | null;
  txHash?: string | null;
  success?: string | null;
}) {
  if (!error && !txHash && !success) {
    return null;
  }

  if (error) {
    return (
      <div className="notice-danger" role="alert">
        <div className="font-medium">{formatActionError(error)}</div>
        {error.txHash ? (
          <a
            className="mt-2 inline-block text-xs underline"
            href={nearExplorerTxUrl(publicConfig.nearNetwork, error.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            View failed NEAR tx
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="notice-ok">
      <div>{success ?? 'Submitted'}</div>
      {txHash ? (
        <a
          className="mt-2 inline-block text-xs underline"
          href={nearExplorerTxUrl(publicConfig.nearNetwork, txHash)}
          target="_blank"
          rel="noreferrer"
        >
          View NEAR tx {txHash.slice(0, 8)}…
        </a>
      ) : null}
    </div>
  );
}
