import { describe, expect, it } from 'vitest';
import { explainGuardError, formatActionError } from './errors';

describe('explainGuardError', () => {
  it('maps contract panic text to a human-readable SG_E code', () => {
    const explained = explainGuardError('Smart contract panicked: SG_E062_PER_TX_LIMIT_EXCEEDED');
    expect(explained.code).toBe('SG_E062_PER_TX_LIMIT_EXCEEDED');
    expect(explained.message).toMatch(/Per-transaction limit/i);
    expect(formatActionError(explained)).toContain('SG_E062');
  });

  it('keeps relay codes that are not SG_E', () => {
    const explained = explainGuardError({
      error: 'Invalid or missing invite token',
      code: 'ACCESS_DENIED',
    });
    expect(explained.code).toBe('ACCESS_DENIED');
    expect(explained.message).toBe('Invalid or missing invite token');
  });
});
