import { describe, expect, it, vi } from 'vitest';
import {
  jwtVerifyOptions,
  ownerActionDisableReason,
  privyUserRequest,
  verifyPrivyAccessToken,
  walletAddressesFromUser,
} from './privy-session';

const APP = 'app_test';
const SECRET = 'sec_test';
const USER = 'did:privy:abc';
const SOL = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_PRIVY_APP_ID: APP,
    PRIVY_APP_SECRET: SECRET,
    ...overrides,
  };
}

describe('privy user request', () => {
  it('uses api.privy.io and attaches privy-app-id plus basic auth', () => {
    const request = privyUserRequest(USER, APP, SECRET);
    expect(request.url).toBe(`https://api.privy.io/v1/users/${encodeURIComponent(USER)}`);
    expect(request.headers['privy-app-id']).toBe(APP);
    expect(request.headers.Accept).toBe('application/json');
    expect(request.headers.Authorization).toBe(
      `Basic ${Buffer.from(`${APP}:${SECRET}`).toString('base64')}`
    );
  });
});

describe('jwt verify options', () => {
  it('requires ES256, exp, and sub', () => {
    expect(jwtVerifyOptions(APP)).toEqual({
      issuer: 'privy.io',
      audience: APP,
      algorithms: ['ES256'],
      requiredClaims: ['exp', 'sub'],
    });
  });
});

describe('linked wallet parsing', () => {
  it('accepts only solana wallets', () => {
    expect(
      walletAddressesFromUser({
        linked_accounts: [
          { type: 'wallet', address: SOL, chain_type: 'solana' },
          { type: 'wallet', address: '0xabc', chain_type: 'ethereum' },
          { type: 'wallet', address: 'no-chain' },
          { type: 'email', address: 'a@b.c' },
        ],
      })
    ).toEqual([SOL]);
    expect(
      walletAddressesFromUser({
        linkedAccounts: [{ type: 'wallet', address: SOL, chainType: 'solana' }],
      })
    ).toEqual([SOL]);
  });
});

describe('verifyPrivyAccessToken', () => {
  it('fetches the user with the required URL and headers', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`https://api.privy.io/v1/users/${encodeURIComponent(USER)}`);
      const headers = init?.headers as Record<string, string>;
      expect(headers['privy-app-id']).toBe(APP);
      expect(headers.Authorization).toBe(
        `Basic ${Buffer.from(`${APP}:${SECRET}`).toString('base64')}`
      );
      expect(headers.Accept).toBe('application/json');
      return {
        ok: true,
        json: async () => ({
          linked_accounts: [{ type: 'wallet', address: SOL, chain_type: 'solana' }],
        }),
      } as Response;
    });

    const session = await verifyPrivyAccessToken('access-token', env(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyJwtImpl: async () => ({ sub: USER, exp: 9_999_999_999 }),
    });
    expect(session).toEqual({ userId: USER, walletAddresses: [SOL] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null when the user lookup fails', async () => {
    const session = await verifyPrivyAccessToken('access-token', env(), {
      fetchImpl: (async () => ({ ok: false, json: async () => ({}) }) as Response) as typeof fetch,
      verifyJwtImpl: async () => ({ sub: USER, exp: 9_999_999_999 }),
    });
    expect(session).toBeNull();
  });

  it('returns null when JWT verification throws (including missing exp)', async () => {
    const session = await verifyPrivyAccessToken('access-token', env(), {
      fetchImpl: vi.fn() as unknown as typeof fetch,
      verifyJwtImpl: async () => {
        throw new Error('missing required claim: exp');
      },
    });
    expect(session).toBeNull();
  });
});

describe('owner action disable reason', () => {
  it('requires Privy secret and pairs INVITE_TOKEN with OWNER_ALLOWLIST', () => {
    expect(ownerActionDisableReason({})).toMatch(/PRIVY_APP_SECRET/);
    expect(
      ownerActionDisableReason(env({ INVITE_TOKEN: 'invite', OWNER_ALLOWLIST: undefined }))
    ).toMatch(/OWNER_ALLOWLIST/);
    expect(
      ownerActionDisableReason(env({ INVITE_TOKEN: 'invite', OWNER_ALLOWLIST: SOL }))
    ).toBeNull();
    expect(ownerActionDisableReason(env())).toBeNull();
  });
});
