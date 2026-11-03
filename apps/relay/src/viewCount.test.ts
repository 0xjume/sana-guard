import { describe, expect, it } from 'vitest';
import { parseOwnerVaultCount } from './viewCount.js';

describe('parseOwnerVaultCount', () => {
  it('accepts non-negative safe integers', () => {
    expect(parseOwnerVaultCount(0)).toBe(0);
    expect(parseOwnerVaultCount(1)).toBe(1);
    expect(parseOwnerVaultCount('4')).toBe(4);
  });

  it('fails closed on empty string and fractions', () => {
    expect(() => parseOwnerVaultCount('')).toThrow(/owner_vault_count/);
    expect(() => parseOwnerVaultCount(1.5)).toThrow(/owner_vault_count/);
    expect(() => parseOwnerVaultCount('1.5')).toThrow(/owner_vault_count/);
    expect(() => parseOwnerVaultCount(null)).toThrow(/owner_vault_count/);
  });
});
