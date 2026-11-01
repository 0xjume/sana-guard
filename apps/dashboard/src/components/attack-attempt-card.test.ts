import { describe, expect, it } from 'vitest';
import { isOnChainRejection, type AttackLabResult } from './attack-attempt-card';

const base: AttackLabResult = {
  kind: 'over_per_tx_limit',
  expected: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
  evaluated: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
};

describe('isOnChainRejection', () => {
  it('is false when no attempts ran', () => {
    expect(isOnChainRejection(base)).toBe(false);
    expect(isOnChainRejection({ ...base, attempts: [] })).toBe(false);
  });

  it('is true when the on-chain code matches expected and is not unexpected', () => {
    expect(
      isOnChainRejection({
        ...base,
        attempts: [{ pass: 1, result: { code: 'SG_E062_PER_TX_LIMIT_EXCEEDED' } }],
      })
    ).toBe(true);
  });

  it('is false when request_sign unexpectedly succeeded', () => {
    expect(
      isOnChainRejection({
        ...base,
        attempts: [{ pass: 1, result: { unexpected: 'request_sign succeeded' } }],
      })
    ).toBe(false);
  });

  it('is false when the on-chain code does not match expected', () => {
    expect(
      isOnChainRejection({
        ...base,
        attempts: [{ pass: 1, result: { code: 'SG_E067_RECIPIENT_NOT_ALLOWED' } }],
      })
    ).toBe(false);
  });
});
