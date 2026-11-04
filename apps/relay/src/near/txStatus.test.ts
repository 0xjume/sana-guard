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

  it('stays pending when CreateVault has only the initiating receipt', () => {
    const initiated = Buffer.from(
      JSON.stringify('vault 1 creation initiated, verifying address'),
      'utf8'
    ).toString('base64');
    const result = parseTxStatusJson({
      result: {
        status: { SuccessValue: initiated },
        final_execution_status: 'INCLUDED',
        transaction_outcome: { outcome: { tokens_burnt: '10' } },
      },
    });
    expect(result.status).toBe('pending');
    expect(result.vaultId).toBeUndefined();
  });

  it('reads the vault id from vault_created once execution has settled', () => {
    const initiated = Buffer.from(
      JSON.stringify('vault 1 creation initiated, verifying address'),
      'utf8'
    ).toString('base64');
    const result = parseTxStatusJson({
      result: {
        status: { SuccessValue: initiated },
        final_execution_status: 'EXECUTED_OPTIMISTIC',
        receipts_outcome: [
          {
            outcome: {
              tokens_burnt: '20',
              logs: [
                'EVENT_JSON:{"standard":"sana_guard","version":"1.0.0","event":{"event":"vault_created","data":{"vault_id":1,"owner":"o","vault_address":"a"}}}',
              ],
            },
          },
        ],
      },
    });
    expect(result.status).toBe('success');
    expect(result.vaultId).toBe(1);
    expect(result.tokensBurntYocto).toBe('20');
  });

  it('fails closed when verification fails instead of trusting the initiating success', () => {
    const initiated = Buffer.from(
      JSON.stringify('vault 1 creation initiated, verifying address'),
      'utf8'
    ).toString('base64');
    const result = parseTxStatusJson({
      result: {
        status: { SuccessValue: initiated },
        final_execution_status: 'EXECUTED_OPTIMISTIC',
        receipts_outcome: [
          {
            outcome: {
              logs: [
                'EVENT_JSON:{"standard":"sana_guard","version":"1.0.0","event":{"event":"vault_verification_failed","data":{"vault_id":1,"reason":"address_mismatch"}}}',
              ],
            },
          },
        ],
      },
    });
    expect(result.status).toBe('failure');
    expect(result.errorMessage).toBe('Vault verification failed');
    expect(result.vaultId).toBeUndefined();
  });

  it('stays pending when a create body omits final_execution_status', () => {
    const initiated = Buffer.from(
      JSON.stringify('vault 1 creation initiated, verifying address'),
      'utf8'
    ).toString('base64');
    const result = parseTxStatusJson({
      result: { status: { SuccessValue: initiated } },
    });
    expect(result.status).toBe('pending');
    expect(result.vaultId).toBeUndefined();
  });

  it('does not treat a fully settled create without vault_created as success', () => {
    const initiated = Buffer.from(
      JSON.stringify('vault 2 creation initiated, verifying address'),
      'utf8'
    ).toString('base64');
    const result = parseTxStatusJson({
      result: {
        status: { SuccessValue: initiated },
        final_execution_status: 'FINAL',
      },
    });
    expect(result.status).toBe('failure');
    expect(result.errorMessage).toBe('Vault verification failed');
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
