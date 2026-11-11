import { describe, expect, it } from 'vitest';
import {
  NO_SIGNATURE_NOTE,
  PRE_SEND_REFUSAL_NOTE,
  attackOutcomeHeading,
  classifyAttackOutcome,
  isOnChainRejection,
  isPreSendRefusal,
  networkFailureResult,
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

  it('is rejected when E062 arrives as the human message plus its code', () => {
    const result = {
      ...base,
      attempts: [
        {
          pass: 1,
          result: {
            message: 'Per-transaction limit exceeded for mint',
            code: 'SG_E062_PER_TX_LIMIT_EXCEEDED',
          },
        },
      ],
    };
    expect(result.attempts[0]?.result.message).not.toMatch(/SG_E062/);
    expect(classifyAttackOutcome(result)).toBe('rejected');
    expect(isOnChainRejection(result)).toBe(true);
    expect(attackOutcomeHeading('rejected')).toBe('Blocked by guard');
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
    const result = { error: 'Unauthorized' };
    expect(classifyAttackOutcome(result)).toBe('failed');
    expect(isPreSendRefusal(result)).toBe(false);
    expect(attackOutcomeHeading('failed')).not.toMatch(/Blocked by guard/i);
  });

  it('is refused for a 409 local-mismatch that never sent request_sign', () => {
    const result = {
      ...base,
      evaluated: 'SG_E067_RECIPIENT_NOT_ALLOWED',
      error:
        'Attack payload did not evaluate to SG_E062_PER_TX_LIMIT_EXCEEDED (got SG_E067_RECIPIENT_NOT_ALLOWED). request_sign was not called.',
    };
    expect(isPreSendRefusal(result)).toBe(true);
    expect(classifyAttackOutcome(result)).toBe('refused');
    expect(attackOutcomeHeading('refused')).toBe('Request refused');
    expect(PRE_SEND_REFUSAL_NOTE).toMatch(/before sending/i);
    expect(PRE_SEND_REFUSAL_NOTE).not.toMatch(/network or server error/i);
  });

  it('is failed for a real transport error from the panel catch', () => {
    const result = networkFailureResult('over_per_tx_limit');
    expect(classifyAttackOutcome(result)).toBe('failed');
    expect(result.error).toMatch(/did not reach the server/i);
  });

  it('is null when no attempts ran', () => {
    expect(classifyAttackOutcome(base)).toBeNull();
    expect(classifyAttackOutcome({ ...base, attempts: [] })).toBeNull();
  });
});
