import { describe, expect, it, vi } from 'vitest';
import { interpretOwnerTxStatus, pollOwnerTxUntilSettled } from './owner-tx';

const TX = 'AdVf7Fxbh6YESDMnJKsBo2Q9oA2AqXDQYSYuYAsLsvh1';

describe('interpretOwnerTxStatus', () => {
  it('keeps a broadcast hash pending until execution is observed', () => {
    expect(interpretOwnerTxStatus(200, { success: true, pending: true, txHash: TX })).toEqual({
      success: true,
      pending: true,
      txHash: TX,
      vaultId: undefined,
    });
  });

  it('returns the vault id from a settled create', () => {
    expect(
      interpretOwnerTxStatus(200, { success: true, pending: false, txHash: TX, vaultId: 1 })
    ).toMatchObject({ success: true, pending: false, txHash: TX, vaultId: 1 });
  });

  it('surfaces a verification failure with the hash', () => {
    const result = interpretOwnerTxStatus(400, {
      success: false,
      txHash: TX,
      error: 'Vault verification failed',
      code: 'VAULT_VERIFICATION_FAILED',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.txHash).toBe(TX);
      expect(result.error.httpStatus).toBe(400);
      expect(result.error.code).toBe('VAULT_VERIFICATION_FAILED');
    }
  });
});

describe('pollOwnerTxUntilSettled', () => {
  it('returns as soon as the relay reports the vault id', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, pending: true, txHash: TX }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, pending: false, txHash: TX, vaultId: 1 }), {
          status: 200,
        })
      );
    let clock = 0;
    const result = await pollOwnerTxUntilSettled({
      txHash: TX,
      owner: 'owner',
      fetcher: fetcher as unknown as typeof fetch,
      sleep: async () => {
        clock += 1_000;
      },
      now: () => clock,
      deadlineMs: 30_000,
      intervalMs: 1_000,
    });
    expect(result).toMatchObject({ success: true, pending: false, vaultId: 1, txHash: TX });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops on a rejected broadcast instead of saying it is still confirming', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: false,
          pending: false,
          txHash: TX,
          error: 'This transaction was rejected before NEAR accepted it.',
          code: 'TX_REJECTED',
        }),
        { status: 400 }
      );
    });
    const result = await pollOwnerTxUntilSettled({
      txHash: TX,
      owner: 'owner',
      fetcher: fetcher as unknown as typeof fetch,
      sleep: async () => {
        throw new Error('should not keep polling');
      },
      now: () => 0,
      deadlineMs: 30_000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TX_REJECTED');
      expect(result.error.txHash).toBe(TX);
      expect(result.error.message).toMatch(/rejected before NEAR accepted/);
      expect(result.error.message).not.toMatch(/still confirming/);
    }
  });

  it('stops when the relay cannot verify the transaction', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          success: false,
          pending: false,
          unverified: true,
          txHash: TX,
          error: 'Could not verify this transaction. Check the transaction link.',
          code: 'TX_UNVERIFIED',
        }),
        { status: 200 }
      );
    });
    const result = await pollOwnerTxUntilSettled({
      txHash: TX,
      owner: 'owner',
      fetcher: fetcher as unknown as typeof fetch,
      sleep: async () => {
        throw new Error('should not keep polling');
      },
      now: () => 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TX_UNVERIFIED');
      expect(result.error.message).toMatch(/Could not verify/);
      expect(result.error.message).toMatch(/transaction link/);
      expect(result.error.txHash).toBe(TX);
    }
  });

  it('keeps the hash when confirmation outlasts the deadline', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ success: true, pending: true, txHash: TX }), {
        status: 200,
      });
    });
    let clock = 0;
    const result = await pollOwnerTxUntilSettled({
      txHash: TX,
      owner: 'owner',
      fetcher: fetcher as unknown as typeof fetch,
      sleep: async () => {
        clock += 1_000;
      },
      now: () => clock,
      deadlineMs: 2_000,
      intervalMs: 1_000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.txHash).toBe(TX);
      expect(result.error.message).toMatch(/still confirming/);
    }
  });
});
