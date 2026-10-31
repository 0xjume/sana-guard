import { describe, it, expect } from 'vitest';
import { forgetAccessKey, rememberSignedNonce } from './nonceCache.js';

describe('access-key nonce cache', () => {
  it('forgets the cached nonce on any send error so the next send refetches', () => {
    const cache: Record<string, { nonce: bigint; permission: string }> = {};
    rememberSignedNonce(cache, 'ed25519:abc', { nonce: 10n, permission: 'FullAccess' }, 11n);
    expect(cache['ed25519:abc']?.nonce).toBe(11n);

    forgetAccessKey(cache, 'ed25519:abc');
    expect(cache['ed25519:abc']).toBeUndefined();
  });
});
