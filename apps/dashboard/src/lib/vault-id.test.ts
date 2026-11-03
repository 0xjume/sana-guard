import { describe, expect, it } from 'vitest';
import { parseVaultId } from './vault-id';

describe('parseVaultId', () => {
  it('accepts non-negative integer ids', () => {
    expect(parseVaultId('0')).toBe(0);
    expect(parseVaultId('12')).toBe(12);
  });

  it('rejects junk so the vault page can render not-found', () => {
    expect(parseVaultId('')).toBeNull();
    expect(parseVaultId('-1')).toBeNull();
    expect(parseVaultId('1.5')).toBeNull();
    expect(parseVaultId('abc')).toBeNull();
    expect(parseVaultId('1e2')).toBeNull();
  });
});
