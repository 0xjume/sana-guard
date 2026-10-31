import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import type { Policy } from '@sana-guard/sdk';
import {
  ATTACK_EXPECTED,
  BURN_ADDRESS,
  buildAttackMessage,
  pickDisallowedProgram,
  replayIdempotencyKey,
  solPerTxLimit,
} from './attack-lab';

const VAULT = 'Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU';
const BLOCKHASH = '11111111111111111111111111111111';

const policy: Policy = {
  perTxLimit: [{ mint: { type: 'sol' }, amount: 50_000_000n }],
  dailyCap: [{ mint: { type: 'sol' }, amount: 100_000_000n }],
  programs: ['11111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111'],
  maxPriorityFeeLamports: 100_000n,
  maxMemoLen: 64,
  expiresAtNs: 1n,
  loosenDelayNs: 1n,
};

describe('attack lab payloads', () => {
  it('builds messages that stay within the parser size bound', () => {
    for (const kind of [
      'over_per_tx_limit',
      'non_allowlisted_recipient',
      'disallowed_program',
      'oversized_priority_fee',
      'replay_idempotency',
    ] as const) {
      const message = buildAttackMessage({
        kind,
        vaultAddress: VAULT,
        recentBlockhash: BLOCKHASH,
        policy,
        allowlistedRecipient: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
      });
      expect(message.length).toBeGreaterThanOrEqual(32);
      expect(message.length).toBeLessThanOrEqual(1167);
      expect(message[0] === 0x81).toBe(false);
    }
  });

  it('uses Token program when it is not on the allowlist', () => {
    expect(pickDisallowedProgram(policy)).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  });

  it('exposes the expected rejection codes and helpers', () => {
    expect(solPerTxLimit(policy)).toBe(50_000_000n);
    expect(replayIdempotencyKey()).toHaveLength(64);
    expect(ATTACK_EXPECTED.over_per_tx_limit).toBe('SG_E062_PER_TX_LIMIT_EXCEEDED');
    expect(new PublicKey(BURN_ADDRESS).toBytes()).toHaveLength(32);
  });
});
