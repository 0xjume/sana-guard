import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import type { Policy } from '@sana-guard/sdk';
import {
  ATTACK_EXPECTED,
  ATTACK_KINDS,
  BURN_ADDRESS,
  buildAttackMessage,
  expectedRejectionForMessage,
  oversizedPriorityFeePrice,
  pickDisallowedProgram,
  solPerTxLimit,
} from './attack-lab';
import { allowAttackLabRequest, attackLabTokensEqual } from './attack-lab-guard';
import { evaluateSignPayload, parseSolanaMessage } from './guard-policy-eval';

const VAULT = 'Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU';
const BLOCKHASH = '11111111111111111111111111111111';
const OWNER = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

const policy: Policy = {
  perTxLimit: [{ mint: { type: 'sol' }, amount: 50_000_000n }],
  dailyCap: [{ mint: { type: 'sol' }, amount: 100_000_000n }],
  programs: ['11111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111'],
  maxPriorityFeeLamports: 100_000n,
  maxMemoLen: 64,
  expiresAtNs: 1n,
  loosenDelayNs: 1n,
};

function messageFor(kind: (typeof ATTACK_KINDS)[number]) {
  return buildAttackMessage({
    kind,
    vaultAddress: VAULT,
    recentBlockhash: BLOCKHASH,
    policy,
    allowlistedRecipient: OWNER,
  });
}

describe('attack lab payloads', () => {
  it('rejects the old (cap+1)*1e6/1.4M price as too low to trip E072', () => {
    const cap = policy.maxPriorityFeeLamports;
    const oldPrice = ((cap + 1n) * 1_000_000n) / 1_400_000n + 1n;
    expect(oldPrice).toBeLessThanOrEqual(cap * 1_000_000n);
    expect(oversizedPriorityFeePrice(policy)).toBe(cap * 1_000_000n + 1n);
  });

  it('evaluates each attack payload against a TS port of policy.rs and rejects', () => {
    const recipients = [OWNER];
    for (const kind of ATTACK_KINDS) {
      const message = messageFor(kind);
      expect(message.length).toBeGreaterThanOrEqual(32);
      expect(message.length).toBeLessThanOrEqual(1167);
      expect(message[0] === 0x81).toBe(false);
      const code = expectedRejectionForMessage(kind, message, {
        vaultAddress: VAULT,
        policy,
        recipients,
      });
      expect(code).toBe(ATTACK_EXPECTED[kind]);
    }
  });

  it('does not accept an oversized-fee transfer to an allowlisted recipient', () => {
    const message = messageFor('oversized_priority_fee');
    const parsed = parseSolanaMessage(message);
    expect('feePayer' in parsed).toBe(true);
    const result = evaluateSignPayload(message, {
      vaultAddress: VAULT,
      policy,
      recipients: [OWNER],
    });
    expect(result).toEqual({ code: 'SG_E072_PRIORITY_FEE_TOO_HIGH' });
  });

  it('uses Token program when it is not on the allowlist', () => {
    expect(pickDisallowedProgram(policy)).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  });

  it('exposes the expected rejection codes and helpers', () => {
    expect(solPerTxLimit(policy)).toBe(50_000_000n);
    expect(ATTACK_KINDS).not.toContain('replay_idempotency');
    expect(ATTACK_EXPECTED.over_per_tx_limit).toBe('SG_E062_PER_TX_LIMIT_EXCEEDED');
    expect(new PublicKey(BURN_ADDRESS).toBytes()).toHaveLength(32);
  });
});

describe('attack lab guard', () => {
  it('compares tokens in constant time and rejects length mismatches', () => {
    expect(attackLabTokensEqual('secret', 'secret')).toBe(true);
    expect(attackLabTokensEqual('secret', 'secreT')).toBe(false);
    expect(attackLabTokensEqual('short', 'longer-token')).toBe(false);
  });

  it('rate-limits a client key', () => {
    const store = new Map<string, number[]>();
    const start = 1_000_000;
    for (let i = 0; i < 8; i += 1) {
      expect(allowAttackLabRequest('ip', start + i, store)).toBe(true);
    }
    expect(allowAttackLabRequest('ip', start + 9, store)).toBe(false);
    expect(allowAttackLabRequest('ip', start + 60_001, store)).toBe(true);
  });
});
