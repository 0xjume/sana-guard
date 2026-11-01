import { describe, expect, it } from 'vitest';
import { isPolicyErrorCode, ruleNameFromCode } from './error-display';

describe('isPolicyErrorCode', () => {
  it('accepts SG_E and E0xx contract codes', () => {
    expect(isPolicyErrorCode('SG_E062_PER_TX_LIMIT_EXCEEDED')).toBe(true);
    expect(isPolicyErrorCode('E074_PROGRAM_NOT_ALLOWED')).toBe(true);
  });

  it('rejects relay and user-cancel codes', () => {
    expect(isPolicyErrorCode('ACCESS_DENIED')).toBe(false);
    expect(isPolicyErrorCode('network')).toBe(false);
    expect(isPolicyErrorCode(undefined)).toBe(false);
  });
});

describe('ruleNameFromCode', () => {
  it('formats SG_E codes into a failed rule name', () => {
    expect(ruleNameFromCode('SG_E062_PER_TX_LIMIT_EXCEEDED')).toBe('Per Tx Limit Exceeded');
  });

  it('formats short E0xx codes', () => {
    expect(ruleNameFromCode('E074_PROGRAM_NOT_ALLOWED')).toBe('Program Not Allowed');
  });

  it('returns the original string when no rule suffix exists', () => {
    expect(ruleNameFromCode('ACCESS_DENIED')).toBe('ACCESS_DENIED');
  });
});
