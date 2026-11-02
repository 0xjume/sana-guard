const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Programs the guard contract can parse, with human labels for the UI. */
export const KNOWN_PROGRAMS: Array<{ id: string; label: string }> = [
  { id: '11111111111111111111111111111111', label: 'System' },
  { id: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', label: 'SPL Token' },
  { id: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', label: 'ATA' },
  { id: 'ComputeBudget111111111111111111111111111111', label: 'Compute Budget' },
  { id: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo', label: 'Memo' },
];

export function programLabel(id: string): string {
  return KNOWN_PROGRAMS.find((program) => program.id === id)?.label ?? shortenAddress(id, 6, 4);
}

/** Solana's per-transaction compute unit ceiling. */
export const MAX_COMPUTE_UNITS = 1_400_000n;

/**
 * Most a single transaction can pay in priority fees under a policy: the per-CU price cap
 * (`max_priority_fee_lamports`, lamports per compute unit) at the runtime CU ceiling, bounded by
 * `max_total_priority_fee_lamports` when set.
 */
export function worstCasePriorityFeeLamports(perCuCap: bigint, totalCap?: bigint): bigint {
  const byPrice = perCuCap * MAX_COMPUTE_UNITS;
  return totalCap !== undefined && totalCap < byPrice ? totalCap : byPrice;
}

export function lamportsToSol(lamports: bigint): string {
  const negative = lamports < 0n;
  const value = negative ? -lamports : lamports;
  const whole = value / LAMPORTS_PER_SOL;
  const frac = value % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  const formatted = fracStr.length === 0 ? whole.toString() : `${whole}.${fracStr}`;
  return negative ? `-${formatted}` : formatted;
}

export function solToLamports(sol: string): bigint {
  const trimmed = sol.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a non-negative SOL amount');
  }
  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  if (fracRaw.length > 9) {
    throw new Error('SOL amount has more than 9 decimal places');
  }
  const frac = (fracRaw + '000000000').slice(0, 9);
  return BigInt(wholeRaw) * LAMPORTS_PER_SOL + BigInt(frac);
}

export function yoctoToNear(yocto: bigint): string {
  const whole = yocto / 1_000_000_000_000_000_000_000_000n;
  const frac = yocto % 1_000_000_000_000_000_000_000_000n;
  const fracStr = frac.toString().padStart(24, '0').replace(/0+$/, '');
  return fracStr.length === 0 ? whole.toString() : `${whole}.${fracStr}`;
}

export function nearToYocto(near: string): bigint {
  const trimmed = near.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a non-negative NEAR amount');
  }
  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  const frac = (fracRaw + '000000000000000000000000').slice(0, 24);
  return BigInt(wholeRaw) * 1_000_000_000_000_000_000_000_000n + BigInt(frac);
}

export function shortenAddress(value: string, left = 4, right = 4): string {
  if (value.length <= left + right + 1) {
    return value;
  }
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function nsToDate(ns: bigint): Date {
  return new Date(Number(ns / 1_000_000n));
}

export function formatTimestampNs(ns: bigint): string {
  const date = nsToDate(ns);
  if (Number.isNaN(date.getTime())) {
    return `${ns.toString()} ns`;
  }
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
}

export function formatDurationNs(ns: bigint): string {
  if (ns <= 0n) {
    return '0s';
  }
  const seconds = ns / 1_000_000_000n;
  const days = seconds / 86_400n;
  const hours = (seconds % 86_400n) / 3_600n;
  const minutes = (seconds % 3_600n) / 60n;
  const rem = seconds % 60n;
  const parts: string[] = [];
  if (days > 0n) parts.push(`${days}d`);
  if (hours > 0n) parts.push(`${hours}h`);
  if (minutes > 0n && days === 0n) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${rem}s`);
  return parts.join(' ');
}

const NS_PER_HOUR = 3_600_000_000_000n;

export function hoursToNs(hours: string): bigint {
  const trimmed = hours.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error('Enter a non-negative delay in hours');
  }
  const [wholeRaw, fracRaw = ''] = trimmed.split('.');
  if (fracRaw.length > 9) {
    throw new Error('Delay has more than 9 decimal places');
  }
  const frac = (fracRaw + '000000000').slice(0, 9);
  const hoursScaled = BigInt(wholeRaw) * 1_000_000_000n + BigInt(frac);
  return hoursScaled * 3_600n;
}

export function nsToHours(ns: bigint): string {
  if (ns <= 0n) {
    return '0';
  }
  const whole = ns / NS_PER_HOUR;
  const rem = ns % NS_PER_HOUR;
  if (rem === 0n) {
    return whole.toString();
  }
  const frac = ((rem * 1_000_000_000n) / NS_PER_HOUR)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '');
  return `${whole}.${frac}`;
}
