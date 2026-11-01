'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { Policy } from '@sana-guard/sdk';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { formatDurationNs } from '@/lib/format';
import { isPolicyStricter, policyLoosenReasons, type PolicyFormValues } from '@/lib/policy';
import { formFromPolicy, policyFromForm } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import type { GuardActionError } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <div className="space-y-4">
      <div
        className={
          stricter
            ? 'rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-accent'
            : 'rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning'
        }
      >
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
        <div className="space-y-2">
          <Label htmlFor="solPerTx">Per-tx SOL</Label>
          <Input id="solPerTx" {...field('solPerTx')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="solDaily">Rolling 24h SOL cap</Label>
          <Input id="solDaily" {...field('solDaily')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxPriorityFeeLamports">Max priority fee (lamports)</Label>
          <Input id="maxPriorityFeeLamports" {...field('maxPriorityFeeLamports')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxTotalPriorityFeeLamports">Max total priority fee (optional)</Label>
          <Input id="maxTotalPriorityFeeLamports" {...field('maxTotalPriorityFeeLamports')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxMemoLen">Max memo length</Label>
          <Input id="maxMemoLen" {...field('maxMemoLen')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="loosenDelayHours">Loosen delay (hours)</Label>
          <Input id="loosenDelayHours" {...field('loosenDelayHours')} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="expiresAtLocal">Expires</Label>
          <Input id="expiresAtLocal" type="datetime-local" {...field('expiresAtLocal')} />
        </div>
      </div>
      {policy.perTxLimit.some((item) => item.mint.type !== 'sol') ||
      policy.dailyCap.some((item) => item.mint.type !== 'sol') ? (
        <p className="text-xs text-muted-foreground">
          Existing SPL token limits are preserved on save. This editor only changes the SOL rows.
        </p>
      ) : null}
      <fieldset>
        <legend className="text-xs text-muted-foreground">Allowed programs</legend>
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
      <Button type="button" disabled={busy || !nextPolicy} onClick={() => void submit()}>
        {busy ? 'Signing…' : 'Sign SetPolicy'}
      </Button>
      <ActionResult error={error} txHash={txHash} success="Policy submitted." />
    </div>
  );
}
