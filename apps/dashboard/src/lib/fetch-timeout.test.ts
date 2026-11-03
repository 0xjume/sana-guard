import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, RequestTimeoutError } from './fetch-timeout';

describe('fetchWithTimeout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a request that never answers into a readable timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          })
      )
    );
    const error = await fetchWithTimeout('https://rpc.example', {}, 'NEAR testnet RPC', 20).catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect((error as Error).message).toBe('NEAR testnet RPC did not respond within 0s');
  });

  it('passes other failures through unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(fetchWithTimeout('https://rpc.example')).rejects.toThrow('Failed to fetch');
  });
});
