import { describe, it, expect } from 'vitest';
import { forgetAccessKey, rememberSignedNonce, shouldForgetAccessKey } from './nonceCache.js';

describe('access-key nonce cache', () => {
  it('forgets the cached nonce when asked', () => {
    const cache: Record<string, { nonce: bigint; permission: string }> = {};
    rememberSignedNonce(cache, 'ed25519:abc', { nonce: 10n, permission: 'FullAccess' }, 11n);
    expect(cache['ed25519:abc']?.nonce).toBe(11n);

    forgetAccessKey(cache, 'ed25519:abc');
    expect(cache['ed25519:abc']).toBeUndefined();
  });

  it('drops the cache only after a pre-acceptance rejection, not a timeout', () => {
    const rejected = new Error('Transaction rejected before acceptance') as Error & {
      type: string;
    };
    rejected.type = 'InvalidNonce';
    expect(shouldForgetAccessKey(rejected)).toBe(true);

    const invalidTx = new Error('InvalidTransaction: expired');
    expect(shouldForgetAccessKey(invalidTx)).toBe(true);

    expect(shouldForgetAccessKey(new Error('NEAR broadcast timed out'))).toBe(false);
    const timeout = new Error('gateway') as Error & { type: string };
    timeout.type = 'TimeoutError';
    expect(shouldForgetAccessKey(timeout)).toBe(false);
  });
});
