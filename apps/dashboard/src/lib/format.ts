const LAMPORTS_PER_SOL = 1_000_000_000n;

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

export function hoursToNs(hours: string): bigint {
  const value = Number(hours);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Enter a non-negative delay in hours');
  }
  return BigInt(Math.round(value * 3_600)) * 1_000_000_000n;
}

export function nsToHours(ns: bigint): string {
  const hours = Number(ns) / 3_600_000_000_000;
  if (!Number.isFinite(hours)) {
    return '0';
  }
  return String(Math.round(hours * 1000) / 1000);
}
