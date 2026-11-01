'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Policy } from '@sana-guard/sdk';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { formatDurationNs } from '@/lib/format';
import { isPolicyStricter, policyLoosenReasons, type PolicyFormValues } from '@/lib/policy';
import { formFromPolicy, policyFromForm } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import type { GuardActionError } from '@/lib/errors';

const KNOWN_PROGRAMS: Array<{ id: string; label: string }> = [
  { id: '11111111111111111111111111111111', label: 'System' },
  { id: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', label: 'SPL Token' },
  { id: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', label: 'ATA' },
  { id: 'ComputeBudget111111111111111111111111111111', label: 'Compute Budget' },
  { id: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo', label: 'Memo' },
];

export function PolicyEditor({
  vaultId,
  policy,
  onUpdated,
}: {
  vaultId: number;
  policy: Policy;
  onUpdated?: () => void;
}) {
  const session = useOwnerSession();
  const [values, setValues] = useState<PolicyFormValues>(() => formFromPolicy(policy));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GuardActionError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    setValues(formFromPolicy(policy));
  }, [policy]);

  const nextPolicy = useMemo(() => {
    try {
      return policyFromForm(values, policy);
    } catch {
      return null;
    }
  }, [values, policy]);

  const reasons = nextPolicy ? policyLoosenReasons(nextPolicy, policy) : [];
  const stricter = nextPolicy ? isPolicyStricter(nextPolicy, policy) : false;

  const submit = async () => {
    if (!session.owner || !session.signer || !nextPolicy) {
      return;
    }
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const result = await ownerActionHelpers(session.owner, session.signer).setPolicy(
        vaultId,
        nextPolicy
      );
      if (result.success) {
        setTxHash(result.txHash);
        onUpdated?.();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'SetPolicy failed' });
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof PolicyFormValues) => ({
    value: values[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <div className="space-y-4">
      <div className={stricter ? 'notice-ok' : 'notice-warn'}>
        {stricter ? (
          <p>
            This change is a <strong>tightening or no-op</strong>. It applies immediately and clears
            any pending loosen.
          </p>
        ) : (
          <p>
            This change <strong>loosens</strong> policy. The guard will schedule it for{' '}
            {formatDurationNs(policy.loosenDelayNs)} ({values.loosenDelayHours}h current delay).
            Tightening is immediate; loosening is never instant.
          </p>
        )}
        {reasons.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-xs">
            {reasons.map((reason) => (
              <li key={`${reason.field}-${reason.detail}`}>{reason.detail}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          Per-tx SOL
          <input className="field mt-1" {...field('solPerTx')} />
        </label>
        <label className="block text-xs">
          Rolling 24h SOL cap
          <input className="field mt-1" {...field('solDaily')} />
        </label>
        <label className="block text-xs">
          Max priority fee (lamports)
          <input className="field mt-1" {...field('maxPriorityFeeLamports')} />
        </label>
        <label className="block text-xs">
          Max total priority fee (optional)
          <input className="field mt-1" {...field('maxTotalPriorityFeeLamports')} />
        </label>
        <label className="block text-xs">
          Max memo length
          <input className="field mt-1" {...field('maxMemoLen')} />
        </label>
        <label className="block text-xs">
          Loosen delay (hours)
          <input className="field mt-1" {...field('loosenDelayHours')} />
        </label>
        <label className="block text-xs sm:col-span-2">
          Expires
          <input className="field mt-1" type="datetime-local" {...field('expiresAtLocal')} />
        </label>
      </div>
      {policy.perTxLimit.some((item) => item.mint.type !== 'sol') ||
      policy.dailyCap.some((item) => item.mint.type !== 'sol') ? (
        <p className="text-xs text-parchment-400">
          Existing SPL token limits are preserved on save. This editor only changes the SOL rows.
        </p>
      ) : null}
      <fieldset>
        <legend className="text-xs text-parchment-400">Allowed programs</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {KNOWN_PROGRAMS.map((program) => (
            <label key={program.id} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={values.programs.includes(program.id)}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    programs: event.target.checked
                      ? [...current.programs, program.id]
                      : current.programs.filter((id) => id !== program.id),
                  }));
                }}
              />
              {program.label}
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        className="btn-primary"
        disabled={busy || !nextPolicy}
        onClick={() => void submit()}
      >
        {busy ? 'Signing…' : 'Sign SetPolicy'}
      </button>
      <ActionResult error={error} txHash={txHash} success="Policy submitted." />
    </div>
  );
}
