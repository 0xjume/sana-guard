import { afterEach, describe, expect, it } from 'vitest';
import { loadPublicConfig } from './config';

const KEYS = [
  'NEXT_PUBLIC_NEAR_NETWORK',
  'NEXT_PUBLIC_GUARD_CONTRACT',
  'NEXT_PUBLIC_NEAR_RPC',
  'NEXT_PUBLIC_PRIVY_APP_ID',
] as const;

describe('loadPublicConfig', () => {
  const snapshot = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of KEYS) {
      const value = snapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('defaults to the testnet guard and rpc', () => {
    const cfg = loadPublicConfig({
      ...process.env,
      NEXT_PUBLIC_NEAR_NETWORK: undefined,
      NEXT_PUBLIC_GUARD_CONTRACT: undefined,
      NEXT_PUBLIC_NEAR_RPC: undefined,
    });
    expect(cfg.nearNetwork).toBe('testnet');
    expect(cfg.guardContract).toBe('guard.djume.testnet');
    expect(cfg.nearRpcUrl).toBe('https://rpc.testnet.near.org');
    expect(cfg.configError).toBeNull();
  });

  it('refuses mainnet without explicit contract and rpc', () => {
    const cfg = loadPublicConfig({
      ...process.env,
      NEXT_PUBLIC_NEAR_NETWORK: 'mainnet',
      NEXT_PUBLIC_GUARD_CONTRACT: undefined,
      NEXT_PUBLIC_NEAR_RPC: undefined,
    });
    expect(cfg.nearNetwork).toBe('mainnet');
    expect(cfg.guardContract).toBe('');
    expect(cfg.nearRpcUrl).toBe('');
    expect(cfg.configError).toMatch(/Mainnet requires NEXT_PUBLIC_GUARD_CONTRACT/);
  });

  it('accepts mainnet when contract and rpc are both set', () => {
    const cfg = loadPublicConfig({
      ...process.env,
      NEXT_PUBLIC_NEAR_NETWORK: 'mainnet',
      NEXT_PUBLIC_GUARD_CONTRACT: 'guard.example.near',
      NEXT_PUBLIC_NEAR_RPC: 'https://rpc.mainnet.near.org',
    });
    expect(cfg.configError).toBeNull();
    expect(cfg.guardContract).toBe('guard.example.near');
    expect(cfg.nearRpcUrl).toBe('https://rpc.mainnet.near.org');
  });
});
