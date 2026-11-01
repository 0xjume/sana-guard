'use client';

import { formatActionError, type GuardActionError } from '@/lib/errors';
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
    return (
      <PolicyVerdict
        verdict="rejected"
        code={error.code}
        actual={formatActionError(error)}
        expected={error.code}
      >
        {error.txHash ? <ProofLink value={error.txHash} kind="near-tx" /> : null}
      </PolicyVerdict>
    );
  }

  return (
    <PolicyVerdict verdict="allowed">
      <p className="text-sm text-foreground">{success ?? 'Submitted'}</p>
      {txHash ? (
        <div className="mt-3">
          <ProofLink value={txHash} kind="near-tx" finalized />
        </div>
      ) : null}
    </PolicyVerdict>
  );
}
