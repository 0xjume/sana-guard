import bs58 from 'bs58';
import type { Mint, Policy } from '@sana-guard/sdk';
import { hoursToNs, nsToHours, solToLamports, lamportsToSol } from './format';
import { defaultCreatePolicyForm, type PolicyFormValues } from './policy';

function mergeSolAmount(
  rows: Array<{ mint: Mint; amount: bigint }>,
  solAmount: bigint,
  addIfMissing: boolean
): Array<{ mint: Mint; amount: bigint }> {
  let found = false;
  const next = rows.map((row) => {
    if (row.mint.type !== 'sol') {
      return row;
    }
    found = true;
    return { mint: row.mint, amount: solAmount };
  });
  if (!found && addIfMissing) {
    next.unshift({ mint: { type: 'sol' }, amount: solAmount });
  }
  return next;
}

/**
 * Encode the editor form. Pass `current` when editing so SPL / unknown limit
 * rows and unchanged integer timestamps are preserved. Reconstructing only the
 * SOL fields would drop token limits (a silent tightening).
 */
export function policyFromForm(values: PolicyFormValues, current?: Policy): Policy {
  const expiresMs = new Date(values.expiresAtLocal).getTime();
  if (!Number.isFinite(expiresMs)) {
    throw new Error('Set a valid expiry date');
  }
  const maxMemoLen = Number(values.maxMemoLen);
  if (!Number.isInteger(maxMemoLen) || maxMemoLen < 0 || maxMemoLen > 65535) {
    throw new Error('max_memo_len must be an integer 0–65535');
  }
  const baseline = current ? formFromPolicy(current) : null;
  const maxPriority = BigInt(values.maxPriorityFeeLamports || '0');
  const totalRaw = values.maxTotalPriorityFeeLamports.trim();
  const expiresAtNs =
    current && baseline && values.expiresAtLocal === baseline.expiresAtLocal
      ? current.expiresAtNs
      : BigInt(expiresMs) * 1_000_000n;
  const loosenDelayNs =
    current && baseline && values.loosenDelayHours === baseline.loosenDelayHours
      ? current.loosenDelayNs
      : hoursToNs(values.loosenDelayHours);

  return {
    ...(current ?? {}),
    perTxLimit: mergeSolAmount(
      current?.perTxLimit ?? [],
      solToLamports(values.solPerTx),
      !current ||
        current.perTxLimit.some((item) => item.mint.type === 'sol') ||
        values.solPerTx.trim() !== '0'
    ),
    dailyCap: mergeSolAmount(
      current?.dailyCap ?? [],
      solToLamports(values.solDaily),
      !current ||
        current.dailyCap.some((item) => item.mint.type === 'sol') ||
        values.solDaily.trim() !== '0'
    ),
    programs: values.programs,
    maxPriorityFeeLamports:
      current && baseline && values.maxPriorityFeeLamports === baseline.maxPriorityFeeLamports
        ? current.maxPriorityFeeLamports
        : maxPriority,
    maxTotalPriorityFeeLamports:
      current &&
      baseline &&
      values.maxTotalPriorityFeeLamports === baseline.maxTotalPriorityFeeLamports
        ? current.maxTotalPriorityFeeLamports
        : totalRaw
          ? BigInt(totalRaw)
          : undefined,
    maxMemoLen,
    expiresAtNs,
    loosenDelayNs,
  };
}

export function formFromPolicy(policy: Policy): PolicyFormValues {
  const solLimit = policy.perTxLimit.find((item) => item.mint.type === 'sol');
  const solCap = policy.dailyCap.find((item) => item.mint.type === 'sol');
  const expires = new Date(Number(policy.expiresAtNs / 1_000_000n));
  const local = Number.isNaN(expires.getTime())
    ? defaultCreatePolicyForm().expiresAtLocal
    : new Date(expires.getTime() - expires.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return {
    solPerTx: solLimit ? lamportsToSol(solLimit.amount) : '0',
    solDaily: solCap ? lamportsToSol(solCap.amount) : '0',
    programs: [...policy.programs],
    maxPriorityFeeLamports: policy.maxPriorityFeeLamports.toString(),
    maxTotalPriorityFeeLamports: policy.maxTotalPriorityFeeLamports?.toString() ?? '',
    maxMemoLen: String(policy.maxMemoLen),
    expiresAtLocal: local,
    loosenDelayHours: nsToHours(policy.loosenDelayNs),
  };
}

export function isBase58Pubkey(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
    return false;
  }
  try {
    const decoded = bs58.decode(value);
    return decoded.length === 32 && bs58.encode(decoded) === value;
  } catch {
    return false;
  }
}
