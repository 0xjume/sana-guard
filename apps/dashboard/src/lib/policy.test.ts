import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import type { Policy } from '@sana-guard/sdk';
import { isPolicyStricter, mintKey, policyLoosenReasons } from './policy';
import { policyFromForm, formFromPolicy } from './policy-form';

const solMint = { type: 'sol' as const };
const splMint = { type: 'spl' as const, address: new PublicKey(new Uint8Array(32).fill(7)) };

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    perTxLimit: [{ mint: solMint, amount: 50_000_000n }],
    dailyCap: [{ mint: solMint, amount: 100_000_000n }],
    programs: ['11111111111111111111111111111111'],
    maxPriorityFeeLamports: 100_000n,
    maxTotalPriorityFeeLamports: 200_000n,
    maxMemoLen: 64,
    expiresAtNs: 1_000n,
    loosenDelayNs: 3_600_000_000_000n,
    ...overrides,
  };
}

describe('policy stricter / loosen', () => {
  it('treats an identical policy as stricter (clears pending_loosen)', () => {
    const current = policy();
    expect(isPolicyStricter(current, current)).toBe(true);
    expect(policyLoosenReasons(current, current)).toEqual([]);
  });

  it('flags added programs, raised caps, removed total fee cap, and a shorter delay', () => {
    const current = policy();
    const next = policy({
      programs: ['11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'],
      perTxLimit: [{ mint: solMint, amount: 80_000_000n }],
      dailyCap: [
        { mint: solMint, amount: 100_000_000n },
        { mint: splMint, amount: 1n },
      ],
      maxPriorityFeeLamports: 200_000n,
      maxTotalPriorityFeeLamports: undefined,
      maxMemoLen: 128,
      expiresAtNs: 2_000n,
      loosenDelayNs: 1_000n,
    });
    const fields = policyLoosenReasons(next, current).map((item) => item.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'programs',
        'perTxLimit',
        'dailyCap',
        'maxPriorityFeeLamports',
        'maxTotalPriorityFeeLamports',
        'maxMemoLen',
        'expiresAtNs',
        'loosenDelayNs',
      ])
    );
    expect(isPolicyStricter(next, current)).toBe(false);
  });

  it('treats a lower total-fee cap and longer delay as stricter', () => {
    const current = policy();
    const next = policy({
      maxTotalPriorityFeeLamports: 50_000n,
      loosenDelayNs: 7_200_000_000_000n,
      perTxLimit: [{ mint: solMint, amount: 10_000_000n }],
    });
    expect(isPolicyStricter(next, current)).toBe(true);
  });

  it('keys SOL and SPL mints separately', () => {
    expect(mintKey(solMint)).toBe('sol');
    expect(mintKey(splMint)).toBe(splMint.address.toBase58());
  });
});

describe('policy form encoding', () => {
  it('round-trips SOL amounts and optional total fee cap', () => {
    const values = formFromPolicy(policy());
    expect(values.solPerTx).toBe('0.05');
    expect(values.solDaily).toBe('0.1');
    expect(values.loosenDelayHours).toBe('1');
    const encoded = policyFromForm({
      ...values,
      expiresAtLocal: '2030-01-01T00:00',
    });
    expect(encoded.perTxLimit[0]?.amount).toBe(50_000_000n);
    expect(encoded.maxTotalPriorityFeeLamports).toBe(200_000n);
  });
});
