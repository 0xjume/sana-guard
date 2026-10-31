import { describe, it, expect } from 'vitest';
import { parseTxStatusJson, sumTokensBurnt } from './txStatus.js';

describe('parseTxStatusJson (NONE wait)', () => {
  it('sums tokens_burnt from the tx and receipts', () => {
    const result = parseTxStatusJson({
      result: {
        status: { SuccessValue: '' },
        transaction_outcome: { outcome: { tokens_burnt: '100' } },
        receipts_outcome: [
          { outcome: { tokens_burnt: '200' } },
          { outcome: { tokens_burnt: '30' } },
        ],
      },
    });
    expect(result.status).toBe('success');
    expect(result.tokensBurntYocto).toBe('330');
  });

  it('treats UNKNOWN_TRANSACTION as unknown, not pending', () => {
    const result = parseTxStatusJson({
      error: { cause: { name: 'UNKNOWN_TRANSACTION' }, name: 'HANDLER_ERROR' },
    });
    expect(result.status).toBe('unknown');
  });

  it('records burnt on a failed outcome', () => {
    const result = parseTxStatusJson({
      result: {
        status: { Failure: { error_message: 'boom' } },
        transaction_outcome: { outcome: { tokens_burnt: '50' } },
        receipts_outcome: [{ outcome: { tokens_burnt: '7' } }],
      },
    });
    expect(result.status).toBe('failure');
    expect(result.tokensBurntYocto).toBe('57');
    expect(
      sumTokensBurnt({
        transaction_outcome: { outcome: { tokens_burnt: '50' } },
        receipts_outcome: [{ outcome: { tokens_burnt: '7' } }],
      })
    ).toBe('57');
  });
});
