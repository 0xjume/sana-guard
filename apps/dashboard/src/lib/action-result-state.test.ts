import { describe, expect, it } from 'vitest';
import { actionResultDisplay, submittedSuccess } from './action-result-state';

describe('actionResultDisplay', () => {
  it('stays idle when a success string is passed with no tx hash or error', () => {
    expect(actionResultDisplay({ success: 'Vault created.' })).toEqual({ kind: 'idle' });
    expect(
      actionResultDisplay({ success: 'Policy submitted.', txHash: null, error: null })
    ).toEqual({ kind: 'idle' });
  });

  it('shows success only after a real tx hash', () => {
    expect(actionResultDisplay({ success: 'Vault created.', txHash: 'abc123' })).toEqual({
      kind: 'success',
      message: 'Vault created.',
      txHash: 'abc123',
    });
    expect(actionResultDisplay({ txHash: 'abc123' })).toEqual({
      kind: 'success',
      message: 'Submitted',
      txHash: 'abc123',
    });
  });

  it('shows errors instead of success', () => {
    const error = { message: 'Owner mismatch', code: 'OWNER' };
    expect(actionResultDisplay({ error, txHash: 'abc123', success: 'Vault created.' })).toEqual({
      kind: 'error',
      error,
    });
  });
});

describe('submittedSuccess', () => {
  it('only returns the form success copy after a tx hash', () => {
    expect(submittedSuccess(null, 'Vault created.')).toBeNull();
    expect(submittedSuccess(undefined, 'Policy submitted.')).toBeNull();
    expect(submittedSuccess('tx', 'Vault created.')).toBe('Vault created.');
  });
});
