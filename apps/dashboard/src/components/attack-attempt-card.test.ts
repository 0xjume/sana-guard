import { describe, expect, it } from 'vitest';
import {
  NO_SIGNATURE_NOTE,
  attackOutcomeHeading,
  classifyAttackOutcome,
  isOnChainRejection,
  unexpectedOutcomeDetail,
  type AttackLabResult,
} from './attack-attempt-card';

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

describe('classifyAttackOutcome', () => {
  it('is rejected when the on-chain code matches expected', () => {
    expect(
      classifyAttackOutcome({
        ...base,
        attempts: [{ pass: 1, result: { code: 'SG_E062_PER_TX_LIMIT_EXCEEDED' } }],
      })
    ).toBe('rejected');
    expect(attackOutcomeHeading('rejected')).toBe('Blocked by guard');
    expect(NO_SIGNATURE_NOTE).toMatch(/no signature/i);
  });

  it('is bypassed only when a signature actually returned', () => {
    expect(
      classifyAttackOutcome({
        ...base,
        attempts: [{ pass: 1, result: { unexpected: 'request_sign succeeded' } }],
      })
    ).toBe('bypassed');
    expect(attackOutcomeHeading('bypassed')).toBe('ALLOWED — guard bypassed');
  });

  it('is unexpected for a different guard error code, with no ALLOWED wording', () => {
    const result = {
      ...base,
      attempts: [{ pass: 1, result: { code: 'SG_E067_RECIPIENT_NOT_ALLOWED' } }],
    };
    expect(classifyAttackOutcome(result)).toBe('unexpected');
    expect(unexpectedOutcomeDetail(result)).toBe('SG_E067_RECIPIENT_NOT_ALLOWED');
    expect(attackOutcomeHeading('unexpected')).toBe('Unexpected outcome');
    expect(attackOutcomeHeading('unexpected')).not.toMatch(/ALLOWED/i);
  });

  it('is failed for a network/RPC failure with no code, distinct from a guard block', () => {
    const result = {
      ...base,
      attempts: [{ pass: 1, result: { message: 'RPC request failed' } }],
    };
    expect(classifyAttackOutcome(result)).toBe('failed');
    expect(unexpectedOutcomeDetail(result)).toBe('RPC request failed');
    expect(attackOutcomeHeading('failed')).toBe('Request failed');
    expect(attackOutcomeHeading('failed')).not.toMatch(/Blocked by guard/i);
    expect(attackOutcomeHeading('failed')).not.toMatch(/ALLOWED/i);
  });

  it('is failed for HTTP / server errors that never reached request_sign', () => {
    const result = { ...base, error: 'Unauthorized' };
    expect(classifyAttackOutcome(result)).toBe('failed');
    expect(attackOutcomeHeading('failed')).not.toMatch(/Blocked by guard/i);
  });

  it('is null when no attempts ran', () => {
    expect(classifyAttackOutcome(base)).toBeNull();
    expect(classifyAttackOutcome({ ...base, attempts: [] })).toBeNull();
  });
});
