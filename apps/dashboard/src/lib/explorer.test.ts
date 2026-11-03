import { describe, expect, it } from 'vitest';
import { addressExplorerUrl, nearExplorerAccountUrl } from './config';

describe('address explorer urls', () => {
  it('points Solana addresses at the matching cluster, defaulting custom RPCs to devnet', () => {
    expect(
      addressExplorerUrl({
        chain: 'solana',
        value: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
        solanaRpcUrl: 'https://api.devnet.solana.com',
      })
    ).toBe(
      'https://explorer.solana.com/address/DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB?cluster=devnet'
    );
    expect(
      addressExplorerUrl({
        chain: 'solana',
        value: 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB',
        solanaRpcUrl: 'https://api.testnet.solana.com',
      })
    ).toContain('cluster=testnet');
  });

  it('points NEAR accounts at NearBlocks on the configured network', () => {
    expect(nearExplorerAccountUrl('testnet', 'agent1.guard.djume.testnet')).toBe(
      'https://testnet.nearblocks.io/address/agent1.guard.djume.testnet'
    );
    expect(nearExplorerAccountUrl('mainnet', 'guard.example.near')).toBe(
      'https://nearblocks.io/address/guard.example.near'
    );
    expect(
      addressExplorerUrl({
        chain: 'near',
        value: 'agent1.guard.djume.testnet',
        nearNetwork: 'testnet',
      })
    ).toBe('https://testnet.nearblocks.io/address/agent1.guard.djume.testnet');
  });
});
