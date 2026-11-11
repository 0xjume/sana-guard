/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SanaGuardSignError, getErrorMessage, toSignError } from '@sana-guard/sdk';
import { AttackAttemptCard, classifyAttackOutcome } from '@/components/attack-attempt-card';
import { attackLabErrorPayload } from './attack-lab-error';

const E062 = 'SG_E062_PER_TX_LIMIT_EXCEEDED';
const HUMAN_E062 = 'Per-transaction limit exceeded for mint';

function signError(code: string): SanaGuardSignError {
  return toSignError(new Error(`Smart contract panicked: ${code}`), 'ab'.repeat(32));
}

afterEach(() => {
  cleanup();
});

describe('attackLabErrorPayload', () => {
  it('keeps SG_E062 when the SDK error message is human text with no SG_E substring', () => {
    expect(getErrorMessage(E062)).toBe(HUMAN_E062);
    const error = signError(E062);
    expect(error.code).toBe(E062);
    expect(error.message).toBe(HUMAN_E062);
    expect(error.message).not.toMatch(/SG_E\d{3}_/);

    const attempt = attackLabErrorPayload(error);
    const result = {
      kind: 'over_per_tx_limit',
      expected: E062,
      evaluated: E062,
      attempts: [{ pass: 1, result: attempt }],
    };

    expect(attempt).toEqual({ message: HUMAN_E062, code: E062 });
    expect(classifyAttackOutcome(result)).toBe('rejected');

    render(<AttackAttemptCard result={result} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Blocked by guard');
    expect(alert.textContent).toContain(E062);
    expect(alert.textContent).not.toContain('Request failed');
    expect(alert.textContent).not.toMatch(/network or server error/i);
  });

  it.each([
    ['SG_E067_RECIPIENT_NOT_ALLOWED', 'non_allowlisted_recipient'],
    ['SG_E074_PROGRAM_NOT_ALLOWED', 'disallowed_program'],
    ['SG_E072_PRIORITY_FEE_TOO_HIGH', 'oversized_priority_fee'],
  ] as const)('keeps %s on the same mapping path (%s)', (code, kind) => {
    const attempt = attackLabErrorPayload(signError(code));
    expect(attempt.message).toBe(getErrorMessage(code));
    expect(attempt.message).not.toContain(code);
    expect(attempt.code).toBe(code);
    expect(
      classifyAttackOutcome({
        kind,
        expected: code,
        evaluated: code,
        attempts: [{ pass: 1, result: attempt }],
      })
    ).toBe('rejected');
  });

  it('still maps a raw contract panic that only has the code in the message', () => {
    const attempt = attackLabErrorPayload(
      new Error('Smart contract panicked: SG_E062_PER_TX_LIMIT_EXCEEDED')
    );
    expect(attempt).toEqual({ message: HUMAN_E062, code: E062 });
  });

  it('leaves a transport failure with no policy code as Request failed', () => {
    const attempt = attackLabErrorPayload(new Error('RPC request failed'));
    expect(attempt).toEqual({ message: 'RPC request failed', code: undefined });
    const result = {
      kind: 'over_per_tx_limit',
      expected: E062,
      evaluated: E062,
      attempts: [{ pass: 1, result: attempt }],
    };
    expect(classifyAttackOutcome(result)).toBe('failed');

    render(<AttackAttemptCard result={result} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Request failed');
    expect(alert.textContent).toMatch(/network or server error/i);
    expect(alert.textContent).not.toContain('Blocked by guard');
  });
});
