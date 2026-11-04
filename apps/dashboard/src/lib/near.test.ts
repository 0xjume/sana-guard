import { afterEach, describe, expect, it } from 'vitest';
import {
  DISPLAY_FINALITY,
  createViewRpc,
  fallbackRpcUrl,
  getSolanaBalanceLamports,
  nearViewQueryBody,
} from './near';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('view reads', () => {
  it('asks for final execution and does not opt into a data cache', () => {
    const body = JSON.parse(
      nearViewQueryBody('guard.djume.testnet', 'get_policy', { vault_id: 1 }, DISPLAY_FINALITY)
    ) as { params: { finality: string; method_name: string } };
    expect(body.params.finality).toBe('final');
    expect(body.params.method_name).toBe('get_policy');
    expect(fallbackRpcUrl('https://rpc.testnet.near.org')).toBe('https://test.rpc.fastnear.com');
    expect(fallbackRpcUrl('http://127.0.0.1:9')).toBeNull();
  });

  it('stays on the primary when it answers, with cache no-store', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const rpc = createViewRpc('https://rpc.testnet.near.org', {
      fetchImpl: async (input, init) => {
        seen.push({ url: String(input), init: init ?? {} });
        return json({
          result: { result: Array.from(Buffer.from('{"per_tx_limit":"40000000"}')) },
        });
      },
    });

    const parsed = (await rpc.post('{"method":"query"}')) as {
      result: { result: number[] };
    };
    expect(parsed.result.result.length).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://rpc.testnet.near.org');
    expect(seen[0]?.init.cache).toBe('no-store');
    expect(seen[0]?.init).not.toHaveProperty('next');
    expect(rpc.chosenUrl()).toBe('https://rpc.testnet.near.org');
  });

  it('fails over once inside one reader, and a new reader starts on the primary', async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('near.org')) {
        throw Object.assign(new Error('slow'), { name: 'TimeoutError' });
      }
      return json({ result: { result: [123] } });
    };

    const first = createViewRpc('https://rpc.testnet.near.org', { fetchImpl });
    await first.post('{}');
    await first.post('{}');
    expect(urls).toEqual([
      'https://rpc.testnet.near.org',
      'https://test.rpc.fastnear.com',
      'https://test.rpc.fastnear.com',
    ]);
    expect(first.chosenUrl()).toBe('https://test.rpc.fastnear.com');

    const second = createViewRpc('https://rpc.testnet.near.org', { fetchImpl });
    await second.post('{}');
    expect(urls[3]).toBe('https://rpc.testnet.near.org');
  });

  it('does not fail over on an application error', async () => {
    const urls: string[] = [];
    const rpc = createViewRpc('https://rpc.testnet.near.org', {
      fetchImpl: async (input) => {
        urls.push(String(input));
        return json({ error: { message: 'wasm execution failed' } });
      },
    });
    const body = (await rpc.post('{}')) as { error?: { message?: string } };
    expect(body.error?.message).toBe('wasm execution failed');
    expect(urls).toEqual(['https://rpc.testnet.near.org']);
  });

  it('does not cache a Solana balance read', async () => {
    const seen: RequestInit[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {});
      return json({ result: { value: 5 } });
    }) as typeof fetch;

    await expect(getSolanaBalanceLamports('addr', 'http://solana.example')).resolves.toBe(5n);
    expect(seen[0]?.cache).toBe('no-store');
    expect(seen[0]).not.toHaveProperty('next');
  });
});
