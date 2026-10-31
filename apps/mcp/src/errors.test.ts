import { SanaGuardError, SanaGuardSignError } from '@sana-guard/sdk';
import { describe, expect, it } from 'vitest';
import { structuredFromUnknown, whyForCode } from './errors.js';
import { generateIdempotencyKey } from './tools.js';

describe('structuredFromUnknown', () => {
  it('keeps requestId and explains E068 / E077', () => {
    const requestId = generateIdempotencyKey();
    const signed = structuredFromUnknown(
      new SanaGuardSignError(
        'Token transfer recipient not in allowlist',
        requestId,
        'SG_E068_RECIPIENT_NOT_ALLOWED'
      )
    );
    expect(signed.requestId).toBe(requestId);
    expect(signed.code).toBe('SG_E068_RECIPIENT_NOT_ALLOWED');
    expect(signed.why).toMatch(/ATA/);

    const exists = structuredFromUnknown(
      new Error('Smart contract panicked: SG_E077_AGENT_EXISTS')
    );
    expect(exists.code).toBe('SG_E077_AGENT_EXISTS');
    expect(exists.why).toMatch(/already registered/);
  });

  it('maps uncoded SanaGuardError without saying Unknown error: SANA_GUARD_ERROR', () => {
    const mapped = structuredFromUnknown(new SanaGuardError('blockhash expired'));
    expect(mapped.code).toBe('SANA_GUARD_ERROR');
    expect(mapped.why).not.toContain('Unknown error: SANA_GUARD_ERROR');
    expect(mapped.why).toBe('blockhash expired');
    expect(whyForCode('SANA_GUARD_ERROR')).not.toContain('Unknown error: SANA_GUARD_ERROR');
  });

  it('always keeps idempotencyKey, requestId, and nearTxHash when supplied', () => {
    const requestId = generateIdempotencyKey();
    const body = structuredFromUnknown(new Error('broadcast failed'), {
      idempotencyKey: requestId,
      requestId,
      nearTxHash: 'NEARHASH',
    });
    expect(body.idempotencyKey).toBe(requestId);
    expect(body.requestId).toBe(requestId);
    expect(body.nearTxHash).toBe('NEARHASH');

    const signed = structuredFromUnknown(
      new SanaGuardSignError('confirm failed', requestId, undefined, 'NEARHASH2'),
      { idempotencyKey: requestId }
    );
    expect(signed.requestId).toBe(requestId);
    expect(signed.idempotencyKey).toBe(requestId);
    expect(signed.nearTxHash).toBe('NEARHASH2');
  });

  it('explains E059 so agents poll get_request instead of retrying', () => {
    expect(whyForCode('SG_E059_DUPLICATE_REQ_ID')).toMatch(/get_request/);
  });
});
