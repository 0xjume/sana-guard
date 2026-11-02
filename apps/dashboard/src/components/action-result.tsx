'use client';

import { actionResultDisplay } from '@/lib/action-result-state';
import { formatActionError, type GuardActionError } from '@/lib/errors';
import { isPolicyErrorCode } from '@/lib/error-display';
import { PolicyVerdict } from '@/components/policy-verdict';
import { ProofLink } from '@/components/proof-link';

function ActionErrorView({ error }: { error: GuardActionError }) {
  const proof = error.txHash ? <ProofLink value={error.txHash} kind="near-tx" /> : null;
  if (isPolicyErrorCode(error.code)) {
    return (
      <PolicyVerdict verdict="rejected" code={error.code} actual={formatActionError(error)}>
        {proof}
      </PolicyVerdict>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-rejected-fill/40 bg-rejected-fill/10 p-4 text-sm text-rejected"
    >
      <p className="font-medium">{formatActionError(error)}</p>
      {proof ? <div className="mt-3">{proof}</div> : null}
    </div>
  );
}

export function ActionResult({
  error,
  txHash,
  success,
}: {
  error?: GuardActionError | null;
  txHash?: string | null;
  success?: string | null;
}) {
  const view = actionResultDisplay({ error, txHash, success });
  if (view.kind === 'idle') {
    return null;
  }
  if (view.kind === 'error') {
    return <ActionErrorView error={view.error} />;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm text-foreground"
    >
      <p>{view.message}</p>
      <div className="mt-3">
        <ProofLink value={view.txHash} kind="near-tx" finalized />
      </div>
    </div>
  );
}
