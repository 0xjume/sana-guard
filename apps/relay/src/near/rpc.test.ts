import { describe, expect, it } from 'vitest';
import { createNearRpc, publicRpcFallback, type NearRpcTiming } from './rpc.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function timeoutError(): Error {
  return Object.assign(new Error('timed out'), { name: 'TimeoutError' });
}

describe('publicRpcFallback', () => {
  it('maps only the slow public NEAR hosts', () => {
    expect(publicRpcFallback('https://rpc.testnet.near.org')).toBe('https://test.rpc.fastnear.com');
    expect(publicRpcFallback('https://archival-rpc.testnet.near.org/')).toBe(
      'https://test.rpc.fastnear.com'
    );
    expect(publicRpcFallback('https://rpc.mainnet.near.org')).toBe(
      'https://rpc.mainnet.fastnear.com'
    );
    expect(publicRpcFallback('https://archival-rpc.mainnet.near.org')).toBe(
      'https://rpc.mainnet.fastnear.com'
    );
    expect(publicRpcFallback('http://127.0.0.1:9')).toBeNull();
    expect(publicRpcFallback('http://localhost:3030')).toBeNull();
    expect(publicRpcFallback('https://my-rpc.example')).toBeNull();
  });
});

describe('createNearRpc', () => {
  it('does not retry a JSON-RPC application error', async () => {
    const urls: string[] = [];
    const timings: NearRpcTiming[] = [];
    const rpc = createNearRpc({
      primaryUrl: 'https://rpc.testnet.near.org',
      fetchImpl: async (input) => {
        urls.push(String(input));
        return json({ error: { message: 'InvalidNonce' } });
      },
      onTiming: (event) => timings.push(event),
    });

    const body = await rpc.request('query', { request_type: 'view_access_key' }, 'access_key');
    expect(body?.error?.message).toBe('InvalidNonce');
    expect(urls).toEqual(['https://rpc.testnet.near.org']);
    expect(timings).toEqual([
      { step: 'access_key', ms: expect.any(Number), endpoint: 'primary', outcome: 'error' },
    ]);
    expect(JSON.stringify(timings)).not.toContain('http');
    expect(rpc.preferredUrl()).toBe('https://rpc.testnet.near.org');
  });

  it('fails over once on a timeout body and then sticks to the fallback', async () => {
    const urls: string[] = [];
    const rpc = createNearRpc({
      primaryUrl: 'https://rpc.testnet.near.org',
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('near.org')) {
          return json({ error: { message: 'Timeout', data: 'timed out' } });
        }
        return json({ result: { ok: true } });
      },
      onTiming: () => undefined,
    });

    await expect(rpc.call('query', {}, 'get_policy')).resolves.toEqual({ ok: true });
    expect(urls).toEqual(['https://rpc.testnet.near.org', 'https://test.rpc.fastnear.com']);

    urls.length = 0;
    await expect(rpc.call('block', { finality: 'optimistic' }, 'block')).resolves.toEqual({
      ok: true,
    });
    expect(urls).toEqual(['https://test.rpc.fastnear.com']);
    expect(rpc.preferredUrl()).toBe('https://test.rpc.fastnear.com');
  });

  it('returns to the primary when the fallback later fails transport', async () => {
    let primaryDown = true;
    let fallbackDown = false;
    const urls: string[] = [];
    const rpc = createNearRpc({
      primaryUrl: 'https://rpc.mainnet.near.org',
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('near.org')) {
          if (primaryDown) throw timeoutError();
          return json({ result: 1 });
        }
        if (fallbackDown) {
          throw timeoutError();
        }
        return json({ result: 1 });
      },
      onTiming: () => undefined,
    });

    await expect(rpc.call('query', {}, 'owner_nonce')).resolves.toBe(1);
    primaryDown = false;
    fallbackDown = true;
    urls.length = 0;
    await expect(rpc.call('query', {}, 'owner_nonce')).resolves.toBe(1);
    expect(urls[0]).toBe('https://rpc.mainnet.fastnear.com');
    expect(urls[1]).toBe('https://rpc.mainnet.near.org');
  });

  it('does not invent a fallback for a custom RPC', async () => {
    const urls: string[] = [];
    const rpc = createNearRpc({
      primaryUrl: 'http://127.0.0.1:9',
      fetchImpl: async (input) => {
        urls.push(String(input));
        throw timeoutError();
      },
      onTiming: () => undefined,
    });

    await expect(rpc.request('query', {}, 'view_account')).resolves.toBeNull();
    expect(urls).toEqual(['http://127.0.0.1:9']);
    expect(rpc.preferredUrl()).toBe('http://127.0.0.1:9');
    await expect(rpc.call('query', {}, 'view_account')).rejects.toThrow('NEAR RPC error');
  });
});
