import { describe, expect, it } from 'vitest';
import {
  decideOwnerGate,
  gateOwnerAction,
  parseOwnerAllowlist,
  type PrivySession,
} from './owner-gate';
import { trustedClientIp } from './rate-limit';

const OWNER = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';
const OTHER = 'Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU';

const session: PrivySession = {
  userId: 'did:privy:test',
  walletAddresses: [OWNER],
};

function allow(overrides: Partial<Parameters<typeof decideOwnerGate>[0]> = {}) {
  return decideOwnerGate({
    configured: true,
    accessToken: 'tok',
    session,
    owner: OWNER,
    allowlist: null,
    ip: '1.2.3.4',
    rateStore: new Map(),
    now: 1_000,
    ...overrides,
  });
}

describe('owner gate', () => {
  it('returns 401 when there is no session', () => {
    expect(allow({ accessToken: null, session: null })).toEqual({
      ok: false,
      status: 401,
      error: 'No session',
    });
    expect(allow({ accessToken: 'tok', session: null })).toEqual({
      ok: false,
      status: 401,
      error: 'No session',
    });
  });

  it('returns 403 when the payload owner is not a linked wallet', () => {
    expect(allow({ owner: OTHER })).toEqual({
      ok: false,
      status: 403,
      error: 'Owner mismatch',
    });
  });

  it('returns 403 when OWNER_ALLOWLIST rejects the owner', () => {
    expect(allow({ allowlist: [OTHER] })).toEqual({
      ok: false,
      status: 403,
      error: 'Owner is not on OWNER_ALLOWLIST',
    });
    expect(parseOwnerAllowlist(' a , b ')).toEqual(['a', 'b']);
    expect(parseOwnerAllowlist('')).toBeNull();
  });

  it('rate-limits per IP and per owner', () => {
    const rateStore = new Map<string, number[]>();
    for (let i = 0; i < 8; i += 1) {
      expect(allow({ rateStore, now: 1_000 + i }).ok).toBe(true);
    }
    expect(allow({ rateStore, now: 1_009 })).toEqual({
      ok: false,
      status: 429,
      error: 'Rate limited',
    });
  });

  it('returns 503 when Privy server auth is not configured', () => {
    expect(allow({ configured: false, accessToken: 'tok', session })).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  it('gateOwnerAction uses the verifier and rejects a bad token', async () => {
    const denied = await gateOwnerAction({
      configured: true,
      accessToken: 'bad',
      owner: OWNER,
      allowlist: null,
      ip: '1.2.3.4',
      rateStore: new Map(),
      verify: async () => null,
    });
    expect(denied).toEqual({ ok: false, status: 401, error: 'No session' });

    const ok = await gateOwnerAction({
      configured: true,
      accessToken: 'good',
      owner: OWNER,
      allowlist: null,
      ip: '1.2.3.4',
      rateStore: new Map(),
      verify: async () => session,
    });
    expect(ok).toEqual({ ok: true });
  });
});

describe('trusted client IP', () => {
  it('prefers Vercel then x-real-ip and ignores client x-forwarded-for', () => {
    expect(
      trustedClientIp(
        new Headers({
          'x-forwarded-for': '8.8.8.8',
          'x-real-ip': '9.9.9.9',
          'x-vercel-forwarded-for': '1.1.1.1, 2.2.2.2',
        })
      )
    ).toBe('1.1.1.1');
    expect(
      trustedClientIp(new Headers({ 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '9.9.9.9' }))
    ).toBe('9.9.9.9');
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '8.8.8.8' }))).toBe('local');
  });
});
