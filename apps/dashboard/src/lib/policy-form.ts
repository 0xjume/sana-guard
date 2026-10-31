import { PublicKey } from '@solana/web3.js';
import type { Policy } from '@sana-guard/sdk';
import { hoursToNs, nsToHours, solToLamports, lamportsToSol } from './format';
import { defaultCreatePolicyForm, type PolicyFormValues } from './policy';

export function policyFromForm(values: PolicyFormValues): Policy {
  const expiresMs = new Date(values.expiresAtLocal).getTime();
  if (!Number.isFinite(expiresMs)) {
    throw new Error('Set a valid expiry date');
  }
  const maxMemoLen = Number(values.maxMemoLen);
  if (!Number.isInteger(maxMemoLen) || maxMemoLen < 0 || maxMemoLen > 65535) {
    throw new Error('max_memo_len must be an integer 0–65535');
  }
  const maxPriority = BigInt(values.maxPriorityFeeLamports || '0');
  const totalRaw = values.maxTotalPriorityFeeLamports.trim();
  return {
    perTxLimit: [{ mint: { type: 'sol' }, amount: solToLamports(values.solPerTx) }],
    dailyCap: [{ mint: { type: 'sol' }, amount: solToLamports(values.solDaily) }],
    programs: values.programs,
    maxPriorityFeeLamports: maxPriority,
    maxTotalPriorityFeeLamports: totalRaw ? BigInt(totalRaw) : undefined,
    maxMemoLen,
    expiresAtNs: BigInt(expiresMs) * 1_000_000n,
    loosenDelayNs: hoursToNs(values.loosenDelayHours),
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
  try {
    const key = new PublicKey(value);
    return key.toBase58() === value || key.toBytes().length === 32;
  } catch {
    return false;
  }
}
