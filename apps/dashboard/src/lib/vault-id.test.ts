import { describe, expect, it } from 'vitest';
import { parseVaultId, vaultPageTitle } from './vault-id';

describe('parseVaultId', () => {
  it('accepts canonical non-negative u32 ids', () => {
    expect(parseVaultId('0')).toBe(0);
    expect(parseVaultId('12')).toBe(12);
    expect(parseVaultId('4294967295')).toBe(4_294_967_295);
  });

  it('rejects junk so the vault page can render not-found', () => {
    expect(parseVaultId('')).toBeNull();
    expect(parseVaultId('-1')).toBeNull();
    expect(parseVaultId('1.5')).toBeNull();
    expect(parseVaultId('abc')).toBeNull();
    expect(parseVaultId('1e2')).toBeNull();
  });

  it('rejects non-canonical forms and u32 overflow', () => {
    expect(parseVaultId('00')).toBeNull();
    expect(parseVaultId('012')).toBeNull();
    expect(parseVaultId('+1')).toBeNull();
    expect(parseVaultId('4294967296')).toBeNull();
    expect(parseVaultId('9999999999')).toBeNull();
    expect(parseVaultId('18446744073709551615')).toBeNull();
  });
});

describe('vaultPageTitle', () => {
  it('uses the canonical id only when parseVaultId accepts it', () => {
    expect(vaultPageTitle('0')).toBe('Vault 0');
    expect(vaultPageTitle('012')).toBe('Vault');
    expect(vaultPageTitle('4294967296')).toBe('Vault');
  });
});
