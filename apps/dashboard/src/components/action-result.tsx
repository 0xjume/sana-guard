'use client';

import { formatActionError, type GuardActionError } from '@/lib/errors';
import { isPolicyErrorCode } from '@/lib/error-display';
import { PolicyVerdict } from '@/components/policy-verdict';
import { ProofLink } from '@/components/proof-link';

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
    if (isPolicyErrorCode(error.code)) {
      return (
        <PolicyVerdict verdict="rejected" code={error.code} actual={formatActionError(error)}>
          {error.txHash ? <ProofLink value={error.txHash} kind="near-tx" /> : null}
        </PolicyVerdict>
      );
    }

    return (
      <div
        role="alert"
        className="rounded-lg border border-rejected-fill/40 bg-rejected-fill/10 p-4 text-sm text-rejected"
      >
        <p className="font-medium">{formatActionError(error)}</p>
        {error.txHash ? (
          <div className="mt-3">
            <ProofLink value={error.txHash} kind="near-tx" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm text-foreground"
    >
      <p>{success ?? 'Submitted'}</p>
      {txHash ? (
        <div className="mt-3">
          <ProofLink value={txHash} kind="near-tx" finalized />
        </div>
      ) : null}
    </div>
  );
}
