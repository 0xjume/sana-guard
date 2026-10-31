import type { Mint, Policy } from '@sana-guard/sdk';

export function mintKey(mint: Mint): string {
  return mint.type === 'sol' ? 'sol' : mint.address.toBase58();
}

export function mintsEqual(a: Mint, b: Mint): boolean {
  return mintKey(a) === mintKey(b);
}

export interface PolicyLoosenReason {
  field: string;
  detail: string;
}

/**
 * Mirrors contracts/guard `is_policy_stricter`. Equal policies are stricter
 * (they apply immediately and clear `pending_loosen`).
 */
export function policyLoosenReasons(next: Policy, current: Policy): PolicyLoosenReason[] {
  const reasons: PolicyLoosenReason[] = [];

  for (const program of next.programs) {
    if (!current.programs.includes(program)) {
      reasons.push({ field: 'programs', detail: `adds program ${program}` });
    }
  }

  for (const limit of next.perTxLimit) {
    const old = current.perTxLimit.find((item) => mintsEqual(item.mint, limit.mint));
    if (!old) {
      reasons.push({ field: 'perTxLimit', detail: `adds mint ${mintKey(limit.mint)}` });
    } else if (limit.amount > old.amount) {
      reasons.push({
        field: 'perTxLimit',
        detail: `raises ${mintKey(limit.mint)} from ${old.amount} to ${limit.amount}`,
      });
    }
  }

  for (const cap of next.dailyCap) {
    const old = current.dailyCap.find((item) => mintsEqual(item.mint, cap.mint));
    if (!old) {
      reasons.push({ field: 'dailyCap', detail: `adds mint ${mintKey(cap.mint)}` });
    } else if (cap.amount > old.amount) {
      reasons.push({
        field: 'dailyCap',
        detail: `raises ${mintKey(cap.mint)} from ${old.amount} to ${cap.amount}`,
      });
    }
  }

  if (next.maxPriorityFeeLamports > current.maxPriorityFeeLamports) {
    reasons.push({
      field: 'maxPriorityFeeLamports',
      detail: `raises price cap from ${current.maxPriorityFeeLamports} to ${next.maxPriorityFeeLamports}`,
    });
  }

  const nextTotal = next.maxTotalPriorityFeeLamports;
  const oldTotal = current.maxTotalPriorityFeeLamports;
  if (oldTotal !== undefined && nextTotal === undefined) {
    reasons.push({
      field: 'maxTotalPriorityFeeLamports',
      detail: 'removes the total priority-fee cap',
    });
  } else if (oldTotal !== undefined && nextTotal !== undefined && nextTotal > oldTotal) {
    reasons.push({
      field: 'maxTotalPriorityFeeLamports',
      detail: `raises total cap from ${oldTotal} to ${nextTotal}`,
    });
  }

  if (next.maxMemoLen > current.maxMemoLen) {
    reasons.push({
      field: 'maxMemoLen',
      detail: `raises memo length from ${current.maxMemoLen} to ${next.maxMemoLen}`,
    });
  }

  if (next.expiresAtNs > current.expiresAtNs) {
    reasons.push({ field: 'expiresAtNs', detail: 'extends policy expiry' });
  }

  if (next.loosenDelayNs < current.loosenDelayNs) {
    reasons.push({ field: 'loosenDelayNs', detail: 'shortens the loosen delay' });
  }

  return reasons;
}

export function isPolicyStricter(next: Policy, current: Policy): boolean {
  return policyLoosenReasons(next, current).length === 0;
}

export interface PolicyFormValues {
  solPerTx: string;
  solDaily: string;
  programs: string[];
  maxPriorityFeeLamports: string;
  maxTotalPriorityFeeLamports: string;
  maxMemoLen: string;
  expiresAtLocal: string;
  loosenDelayHours: string;
}

export function defaultCreatePolicyForm(): PolicyFormValues {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const local = new Date(expires.getTime() - expires.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  return {
    solPerTx: '0.05',
    solDaily: '0.1',
    programs: ['11111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111'],
    maxPriorityFeeLamports: '100000',
    maxTotalPriorityFeeLamports: '',
    maxMemoLen: '64',
    expiresAtLocal: local,
    loosenDelayHours: '1',
  };
}
