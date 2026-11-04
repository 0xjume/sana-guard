import { describe, expect, it, vi } from 'vitest';
import { handleOwnerTxGet } from './owner-tx-handler';
import type { PrivySession } from './owner-gate';

const OWNER = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';
const OTHER = 'Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU';
const TX = 'AdVf7Fxbh6YESDMnJKsBo2Q9oA2AqXDQYSYuYAsLsvh1';
const session: PrivySession = { userId: 'did:privy:test', walletAddresses: [OWNER] };

function request(query: string, token = 'tok'): Request {
  return new Request(`http://localhost/api/owner-tx?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function get(args: {
  query: string;
  fetchImpl?: typeof fetch;
  rateStore?: Map<string, number[]>;
  verify?: () => Promise<PrivySession | null>;
}) {
  return handleOwnerTxGet({
    request: request(args.query),
    disableReason: null,
    verify: args.verify ?? (async () => session),
    allowlist: null,
    rateStore: args.rateStore ?? new Map(),
    ip: '1.2.3.4',
    relayUrl: 'https://relay.example.test',
    fetchImpl: args.fetchImpl,
  });
}

describe('handleOwnerTxGet', () => {
  it('requires a session and a linked owner before it calls the relay', async () => {
    const fetchImpl = vi.fn();
    const denied = await get({
      query: `txHash=${TX}&owner=${OWNER}`,
      verify: async () => null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(denied.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('proxies a settled status for the signed-in owner', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ success: true, pending: false, txHash: TX, vaultId: 1, owner: OWNER }),
        { status: 200 }
      );
    });
    const response = await get({
      query: `txHash=${TX}&owner=${OWNER}`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ vaultId: 1, pending: false });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://relay.example.test/v1/admin/tx/${TX}`,
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('hides a transaction that belongs to another owner', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ success: true, pending: true, txHash: TX, owner: OTHER }),
        { status: 200 }
      );
    });
    const response = await get({
      query: `txHash=${TX}&owner=${OWNER}`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(response.status).toBe(404);
  });

  it('does not spend the owner-action write budget', async () => {
    const rateStore = new Map<string, number[]>();
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ success: true, pending: true, txHash: TX, owner: OWNER }),
        {
          status: 200,
        }
      );
    });
    for (let i = 0; i < 9; i += 1) {
      const response = await get({
        query: `txHash=${TX}&owner=${OWNER}`,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        rateStore,
      });
      expect(response.status).toBe(200);
    }
  });
});
