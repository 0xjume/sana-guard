import { describe, expect, it } from 'vitest';
import { countContractVaults, vaultListHasMore } from './contract-vault-count';

describe('contract vault count', () => {
  it('counts live vault entries, including id 0', () => {
    expect(countContractVaults([])).toBe(0);
    expect(countContractVaults([{ id: 0 }, { id: 1 }])).toBe(2);
  });

  it('asks for another page only when this page was full', () => {
    expect(vaultListHasMore(100, 100)).toBe(true);
    expect(vaultListHasMore(2, 100)).toBe(false);
    expect(vaultListHasMore(0, 100)).toBe(false);
  });
});
