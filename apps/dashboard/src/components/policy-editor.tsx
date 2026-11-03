'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { Policy } from '@sana-guard/sdk';
import { ownerActionHelpers } from '@/hooks/use-owner-actions';
import { useOwnerSession } from '@/hooks/use-owner-session';
import { submittedSuccess } from '@/lib/action-result-state';
import type { GuardActionError } from '@/lib/errors';
import {
  formatDurationNs,
  KNOWN_PROGRAMS,
  lamportsToSol,
  worstCasePriorityFeeLamports,
} from '@/lib/format';
import { isPolicyStricter, policyLoosenReasons, type PolicyFormValues } from '@/lib/policy';
import { formFromPolicy, policyFromForm } from '@/lib/policy-form';
import { ActionResult } from './action-result';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function hasPreservedSplLimits(policy: Policy): boolean {
  return (
    policy.perTxLimit.some((item) => item.mint.type !== 'sol') ||
    policy.dailyCap.some((item) => item.mint.type !== 'sol')
  );
}

function parseCount(value: string): bigint | null {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}

/** Spells out the worst-case fee per transaction so the per-CU unit can't be misread. */
function PriorityFeeWarning({ perCu, total }: { perCu: string; total: string }) {
  const perCuValue = parseCount(perCu);
  const totalValue = total.trim() === '' ? undefined : parseCount(total);
  if (perCuValue === null || totalValue === null || perCuValue === 0n) {
    return null;
  }
  const worst = worstCasePriorityFeeLamports(perCuValue, totalValue);
  const uncapped = totalValue === undefined;
  return (
    <p
      className={
        uncapped
          ? 'rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning sm:col-span-2'
          : 'text-xs text-muted-foreground sm:col-span-2'
      }
    >
      Worst case per transaction: up to <strong>{lamportsToSol(worst)} SOL</strong> in priority fees
      {uncapped ? ' (no total cap set).' : '.'} Fees count toward the SOL per-tx and 24h caps.
    </p>
  );
}

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
  const noticeClassName = stricter
    ? 'rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-accent'
    : 'rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning';

  async function submit(): Promise<void> {
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
  }

  function field(key: keyof PolicyFormValues) {
    return {
      value: values[key] as string,
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        setValues((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  return (
    <div className="space-y-4">
      <div className={noticeClassName}>
        {stricter ? (
          <p>
            This change is a <strong>tightening or no-op</strong>. It applies immediately and clears
            any pending loosen.
          </p>
        ) : (
          <p>
            This change <strong>loosens</strong> policy. The guard will schedule it for{' '}
            {formatDurationNs(policy.loosenDelayNs)} (the vault's current loosen delay). Tightening
            is immediate; loosening is never instant.
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
          <Label htmlFor="maxPriorityFeeLamports">Max compute-unit price (lamports per CU)</Label>
          <Input
            id="maxPriorityFeeLamports"
            inputMode="numeric"
            aria-describedby="maxPriorityFeeLamports-help"
            {...field('maxPriorityFeeLamports')}
          />
          <p id="maxPriorityFeeLamports-help" className="text-xs text-muted-foreground">
            <code>max_priority_fee_lamports</code>. Caps SetComputeUnitPrice per compute unit; 1 =
            1,000,000 micro-lamports/CU. 0 forbids priority fees.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="maxTotalPriorityFeeLamports">
            Max total priority fee per transaction (lamports)
          </Label>
          <Input
            id="maxTotalPriorityFeeLamports"
            inputMode="numeric"
            placeholder="No cap"
            aria-describedby="maxTotalPriorityFeeLamports-help"
            {...field('maxTotalPriorityFeeLamports')}
          />
          <p id="maxTotalPriorityFeeLamports-help" className="text-xs text-muted-foreground">
            <code>max_total_priority_fee_lamports</code>. The setting that bounds what one
            transaction can burn in fees. 1,000,000 = 0.001 SOL.
          </p>
        </div>
        <PriorityFeeWarning
          perCu={values.maxPriorityFeeLamports}
          total={values.maxTotalPriorityFeeLamports}
        />
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
      {hasPreservedSplLimits(policy) ? (
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
      <ActionResult
        error={error}
        txHash={txHash}
        success={submittedSuccess(txHash, 'Policy submitted.')}
      />
    </div>
  );
}
