import { parseVaultState } from '../views';
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
