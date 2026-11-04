import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindOwnerSignProgress } from '@/lib/sign-progress';

const events = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/near', () => ({
  createViews: () => ({
    getNonce: async () => 4,
  }),
}));

vi.mock('@/lib/relay', () => ({
  submitOwnerAction: async () => ({ success: true, pending: true, txHash: 'hash123' }),
}));

vi.mock('@/lib/owner-tx', () => ({
  pollOwnerTxUntilSettled: async () => {
    events.push('poll');
    return { success: true, pending: false, txHash: 'hash123' };
  },
}));

import { runOwnerAction } from './use-owner-actions';

describe('runOwnerAction progress', () => {
  afterEach(() => {
    events.length = 0;
  });

  it('shows confirming with the tx hash before polling, then clears it', async () => {
    const hashes: Array<string | null> = [];
    const unbind = bindOwnerSignProgress((progress) => {
      events.push(progress?.phase ?? 'cleared');
      hashes.push(progress && progress.phase === 'confirming' ? progress.txHash : null);
    });

    const result = await runOwnerAction({
      owner: 'owner',
      signer: {} as never,
      build: async () => ({ message: 'signed-message', signature: new Uint8Array([1]) }),
    });

    unbind();
    expect(result).toEqual({ success: true, pending: false, txHash: 'hash123' });
    expect(events).toEqual(['confirming', 'poll', 'cleared']);
    expect(hashes[0]).toBe('hash123');
  });
});
