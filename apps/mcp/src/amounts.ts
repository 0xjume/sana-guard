import { SanaGuardError } from '@sana-guard/sdk';

/** Parse a non-negative integer amount from a decimal string (or bigint). */
export function parseAmountString(value: string | bigint, label = 'amount'): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new SanaGuardError(`${label} must be a non-negative integer`);
    }
    return value;
  }
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new SanaGuardError(
      `${label} must be a base-unit integer string (got ${JSON.stringify(value)})`
    );
  }
  return BigInt(trimmed);
}

export function amountToString(value: bigint | string | number): string {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new SanaGuardError(`Invalid amount: ${value}`);
    }
    return BigInt(value).toString();
  }
  return parseAmountString(value).toString();
}

/** JSON.stringify that turns bigint into decimal strings. */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner),
    2
  );
}
