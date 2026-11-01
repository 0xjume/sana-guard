import { describe, expect, it } from 'vitest';
import { ruleNameFromCode } from './error-display';

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
