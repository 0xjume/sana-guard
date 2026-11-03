import { describe, expect, it, vi } from 'vitest';
import {
  GENERIC_PAGE_ERROR,
  GENERIC_ROOT_ERROR,
  isPolicyErrorCode,
  logUnexpectedError,
  publicErrorCopy,
  ruleNameFromCode,
} from './error-display';

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

describe('publicErrorCopy', () => {
  it('shows a generic message and optional digest, never the raw error text', () => {
    expect(publicErrorCopy({ digest: 'abc123' }, GENERIC_PAGE_ERROR)).toEqual({
      message: `${GENERIC_PAGE_ERROR} (ref abc123)`,
      digest: 'abc123',
    });
    expect(publicErrorCopy({}, GENERIC_ROOT_ERROR).message).toBe(GENERIC_ROOT_ERROR);
    expect(publicErrorCopy({ digest: 'x' }, GENERIC_PAGE_ERROR).message).not.toMatch(
      /RPC|ECONNRESET|stack/i
    );
  });

  it('logs the detailed error for operators', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logUnexpectedError('app/error', new Error('NEAR RPC HTTP 500'));
    expect(spy).toHaveBeenCalledWith('app/error', expect.any(Error));
    spy.mockRestore();
  });
});
