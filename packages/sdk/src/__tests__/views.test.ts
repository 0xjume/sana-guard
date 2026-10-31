import { parseVaultState, parseSpend24hJson, parseU64Amount } from '../views';
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
