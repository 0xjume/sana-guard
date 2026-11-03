import { parseVaultState, parseSpend24hJson, parseU64Amount, parseVaultCount } from '../views';
import { SanaGuardError } from '../errors';

describe('parseVaultState', () => {
  it('accepts Active and PendingVerification', () => {
    expect(parseVaultState('Active')).toBe('Active');
    expect(parseVaultState('PendingVerification')).toBe('PendingVerification');
  });

  it('throws when state is missing or unknown', () => {
    expect(() => parseVaultState(undefined)).toThrow(SanaGuardError);
    expect(() => parseVaultState(null)).toThrow(SanaGuardError);
    expect(() => parseVaultState('Paused')).toThrow(SanaGuardError);
    expect(() => parseVaultState('')).toThrow('Invalid or missing vault state');
  });
});

describe('parseSpend24hJson', () => {
  const unsafe = '9007199254740993';

  it('preserves u64 JSON numbers that JSON.parse would round', () => {
    expect(Number(unsafe)).toBe(9007199254740992);
    const parsed = parseSpend24hJson(`[["Sol", ${unsafe}]]`);
    expect(parsed).toEqual([{ mint: 'Sol', amount: BigInt(unsafe) }]);
  });

  it('accepts string-encoded u64 amounts (current contract U64 form)', () => {
    const parsed = parseSpend24hJson(`[["SOL", "${unsafe}"]]`);
    expect(parsed).toEqual([{ mint: 'SOL', amount: BigInt(unsafe) }]);
  });

  it('accepts safe JSON numbers and zero', () => {
    expect(parseSpend24hJson('[["Sol", 1000], ["Sol", 0]]')).toEqual([
      { mint: 'Sol', amount: BigInt(1000) },
      { mint: 'Sol', amount: BigInt(0) },
    ]);
  });

  it('parseU64Amount accepts string, number, and bigint', () => {
    expect(parseU64Amount('18446744073709551615')).toBe(BigInt('18446744073709551615'));
    expect(parseU64Amount(42)).toBe(BigInt(42));
    expect(parseU64Amount(BigInt(7))).toBe(BigInt(7));
    expect(() => parseU64Amount(-1)).toThrow(SanaGuardError);
    expect(() => parseU64Amount('not-a-number')).toThrow(SanaGuardError);
  });
});

describe('parseVaultCount', () => {
  it('accepts non-negative safe integers and their decimal strings', () => {
    expect(parseVaultCount(0)).toBe(0);
    expect(parseVaultCount(3)).toBe(3);
    expect(parseVaultCount('0')).toBe(0);
    expect(parseVaultCount('12', 'owner_vault_count')).toBe(12);
    expect(parseVaultCount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('fails closed on empty string instead of treating it as zero', () => {
    expect(() => parseVaultCount('')).toThrow(SanaGuardError);
    expect(() => parseVaultCount('')).toThrow(/vault count/);
  });

  it('fails closed on fractional values', () => {
    expect(() => parseVaultCount(1.5)).toThrow(SanaGuardError);
    expect(() => parseVaultCount('1.5')).toThrow(/vault count/);
    expect(() => parseVaultCount('0.0')).toThrow(SanaGuardError);
  });

  it('rejects other non-integers so callers never treat them as zero', () => {
    for (const raw of [
      ' ',
      '01',
      '1e2',
      '-1',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      undefined,
      true,
      9007199254740993,
      '9007199254740993',
    ]) {
      expect(() => parseVaultCount(raw)).toThrow(SanaGuardError);
    }
  });
});
