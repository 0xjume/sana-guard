import { PublicKey } from '@solana/web3.js';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, type Policy, type VaultView } from '@sana-guard/sdk';
import { describe, expect, it } from 'vitest';
import { SERVER_MAX_CODE } from './errors.js';
import { checkTransfer } from './policyCheck.js';

const recipient = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    perTxLimit: [{ mint: { type: 'sol' }, amount: 50_000_000n }],
    dailyCap: [{ mint: { type: 'sol' }, amount: 100_000_000n }],
    programs: [SYSTEM_PROGRAM.toBase58(), TOKEN_PROGRAM.toBase58()],
    maxPriorityFeeLamports: 100_000n,
    maxMemoLen: 64,
    expiresAtNs: 9_000_000_000_000_000_000n,
    loosenDelayNs: 1n,
    ...overrides,
  };
}

function vault(overrides: Partial<VaultView> = {}): VaultView {
  return {
    owner: 'owner',
    vaultAddress: 'Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU',
    path: 'vault/x/0',
    agents: ['agent1.guard.djume.testnet'],
    policy: policy(),
    paused: false,
    state: 'Active',
    ...overrides,
  };
}

describe('checkTransfer', () => {
  it('passes a SOL transfer inside limits to an allowlisted wallet', async () => {
    const result = await checkTransfer({
      vault: vault(),
      recipients: [recipient],
      spend24h: [{ mint: 'SOL', amount: 10_000_000n }],
      nowNs: 1n,
      input: { kind: 'sol', to: recipient, amount: 20_000_000n },
    });
    expect(result.wouldPass).toBe(true);
    expect(result.remaining24h).toBe('90000000');
    expect(result.reasons).toEqual([]);
  });

  it('fails per-tx, daily cap, recipient, pause, expiry, and server max with codes', async () => {
    const overTx = await checkTransfer({
      vault: vault(),
      recipients: [recipient],
      spend24h: [],
      nowNs: 1n,
      input: { kind: 'sol', to: recipient, amount: 80_000_000n },
    });
    expect(overTx.reasons.map((r) => r.code)).toContain('SG_E062_PER_TX_LIMIT_EXCEEDED');

    const overDay = await checkTransfer({
      vault: vault(),
      recipients: [recipient],
      spend24h: [{ mint: 'Sol', amount: 90_000_000n }],
      nowNs: 1n,
      input: { kind: 'sol', to: recipient, amount: 20_000_000n },
    });
    expect(overDay.reasons.map((r) => r.code)).toContain('SG_E064_DAILY_CAP_EXCEEDED');

    const badRecipient = await checkTransfer({
      vault: vault(),
      recipients: [],
      spend24h: [],
      nowNs: 1n,
      input: { kind: 'sol', to: recipient, amount: 1n },
    });
    expect(badRecipient.reasons.map((r) => r.code)).toContain('SG_E067_RECIPIENT_NOT_ALLOWED');

    const paused = await checkTransfer({
      vault: vault({ paused: true }),
      recipients: [recipient],
      spend24h: [],
      nowNs: 1n,
      input: { kind: 'sol', to: recipient, amount: 1n },
    });
    expect(paused.reasons.map((r) => r.code)).toContain('SG_E055_VAULT_PAUSED');

    const expired = await checkTransfer({
      vault: vault({ policy: policy({ expiresAtNs: 1n }) }),
      recipients: [recipient],
      spend24h: [],
      nowNs: 2n,
      input: { kind: 'sol', to: recipient, amount: 1n },
    });
    expect(expired.reasons.map((r) => r.code)).toContain('SG_E057_POLICY_EXPIRED');

    const serverMax = await checkTransfer({
      vault: vault(),
      recipients: [recipient],
      spend24h: [],
      nowNs: 1n,
      maxLamportsPerCall: 1_000n,
      input: { kind: 'sol', to: recipient, amount: 2_000n },
    });
    expect(serverMax.reasons.map((r) => r.code)).toContain(SERVER_MAX_CODE);
  });

  it('requires the SPL destination ATA on the allowlist (SG_E068)', async () => {
    const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const result = await checkTransfer({
      vault: vault({
        policy: policy({
          perTxLimit: [{ mint: { type: 'spl', address: mint }, amount: 1_000_000n }],
          dailyCap: [{ mint: { type: 'spl', address: mint }, amount: 5_000_000n }],
        }),
      }),
      recipients: [recipient],
      spend24h: [],
      nowNs: 1n,
      input: { kind: 'spl', to: recipient, amount: 1n, mint: mint.toBase58() },
    });
    expect(result.wouldPass).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('SG_E068_RECIPIENT_NOT_ALLOWED');
    expect(result.recipientChecked).not.toBe(recipient);
  });

  it('does not sign — it only returns a verdict', async () => {
    const result = await checkTransfer({
      vault: null,
      recipients: [],
      spend24h: [],
      nowNs: 1n,
      input: { kind: 'sol', to: recipient, amount: 1n },
    });
    expect(result.wouldPass).toBe(false);
    expect(result.reasons[0]?.code).toBe('SG_E054_VAULT_NOT_FOUND');
  });
});
