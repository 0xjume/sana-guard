import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import type { VaultView } from '@sana-guard/sdk';
import { RequestTimeoutError } from './fetch-timeout';
import {
  deserializeVaultSnapshot,
  loadVaultSnapshot,
  serializeVaultSnapshot,
  type VaultSnapshot,
} from './vault-snapshot';

const VAULT: VaultView = {
  owner: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
  vaultAddress: 'SoL11111111111111111111111111111111111111112',
  path: "m/44'/501'/0'",
  agents: ['agent1.guard.djume.testnet'],
  policy: {
    perTxLimit: [{ mint: { type: 'sol' }, amount: 50_000_000n }],
    dailyCap: [
      { mint: { type: 'sol' }, amount: 100_000_000n },
      {
        mint: {
          type: 'spl',
          address: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        },
        amount: 99n,
      },
    ],
    programs: ['11111111111111111111111111111111'],
    maxPriorityFeeLamports: 100_000n,
    maxTotalPriorityFeeLamports: 1_000_000n,
    maxMemoLen: 64,
    expiresAtNs: 1_800_000_000_000_000_000n,
    loosenDelayNs: 3_600_000_000_000n,
  },
  pendingLoosen: {
    policy: {
      perTxLimit: [{ mint: { type: 'sol' }, amount: 80_000_000n }],
      dailyCap: [{ mint: { type: 'sol' }, amount: 200_000_000n }],
      programs: ['11111111111111111111111111111111'],
      maxPriorityFeeLamports: 100_000n,
      maxMemoLen: 64,
      expiresAtNs: 1_800_000_000_000_000_000n,
      loosenDelayNs: 3_600_000_000_000n,
    },
    effectiveNs: 1_900_000_000_000_000_000n,
  },
  paused: false,
  state: 'Active',
};

function okSnapshot(): VaultSnapshot {
  return {
    vaultId: 0,
    status: 'ok',
    vault: VAULT,
    recipients: ['Recip111111111111111111111111111111111111111'],
    spend: [{ mint: 'SOL', amount: 1_000_000n }],
    balance: 2_500_000_000n,
  };
}

describe('serializeVaultSnapshot', () => {
  it('round-trips bigints and SPL mints through JSON so the first paint can hydrate', () => {
    const serialized = serializeVaultSnapshot(okSnapshot());
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
    const restored = deserializeVaultSnapshot(serialized);
    expect(restored.status).toBe('ok');
    expect(restored.vault?.agents).toEqual(['agent1.guard.djume.testnet']);
    expect(restored.vault?.policy.perTxLimit[0]?.amount).toBe(50_000_000n);
    expect(restored.vault?.policy.maxTotalPriorityFeeLamports).toBe(1_000_000n);
    expect(restored.vault?.pendingLoosen?.effectiveNs).toBe(1_900_000_000_000_000_000n);
    const spl = restored.vault?.policy.dailyCap[1]?.mint;
    expect(spl?.type).toBe('spl');
    if (spl?.type === 'spl') {
      expect(spl.address.toBase58()).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    }
    expect(restored.spend?.[0]?.amount).toBe(1_000_000n);
    expect(restored.balance).toBe(2_500_000_000n);
  });
});

describe('loadVaultSnapshot', () => {
  it('returns not_found when the vault view is missing', async () => {
    const snapshot = await loadVaultSnapshot(9, {
      views: {
        getVault: async () => null,
        getRecipients: async () => [],
        getSpend24h: async () => [],
      },
    });
    expect(snapshot).toEqual({ vaultId: 9, status: 'not_found' });
  });

  it('loads vault, policy, agents, recipients, spend and balance together', async () => {
    const snapshot = await loadVaultSnapshot(0, {
      views: {
        getVault: async () => VAULT,
        getRecipients: async () => ['Recip111111111111111111111111111111111111111'],
        getSpend24h: async () => [{ mint: 'SOL', amount: 1_000_000n }],
      },
      getBalance: async () => 2_500_000_000n,
    });
    expect(snapshot.status).toBe('ok');
    expect(snapshot.vault?.policy.perTxLimit[0]?.amount).toBe(50_000_000n);
    expect(snapshot.vault?.agents).toEqual(['agent1.guard.djume.testnet']);
    expect(snapshot.recipients).toHaveLength(1);
    expect(snapshot.spend?.[0]?.amount).toBe(1_000_000n);
    expect(snapshot.balance).toBe(2_500_000_000n);
  });

  it('keeps the vault when allowlists or spend fail, matching the 10s client behaviour', async () => {
    const snapshot = await loadVaultSnapshot(0, {
      views: {
        getVault: async () => VAULT,
        getRecipients: async () => {
          throw new RequestTimeoutError('NEAR testnet RPC', 10_000);
        },
        getSpend24h: async () => [],
      },
      getBalance: async () => {
        throw new Error('Solana RPC HTTP 500');
      },
    });
    expect(snapshot.status).toBe('ok');
    expect(snapshot.vault?.owner).toBe(VAULT.owner);
    expect(snapshot.recipients).toEqual([]);
    expect(snapshot.spend).toEqual([]);
    expect(snapshot.balance).toBeNull();
  });

  it('returns a readable error when the vault read times out', async () => {
    const snapshot = await loadVaultSnapshot(0, {
      views: {
        getVault: async () => {
          throw new RequestTimeoutError('NEAR testnet RPC', 10_000);
        },
        getRecipients: async () => [],
        getSpend24h: async () => [],
      },
    });
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toBe('NEAR testnet RPC did not respond within 10s');
  });
});
