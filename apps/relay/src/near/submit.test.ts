import { afterEach, describe, expect, it } from 'vitest';
import * as nearAPI from 'near-api-js';
import { NearClientImpl } from './client.js';

const { KeyPair, utils } = nearAPI;

const BLOCK_HASH = utils.serialize.base_encode(new Uint8Array(32).fill(7));
const RPC = 'http://127.0.0.1:9';

interface RpcCall {
  url: string;
  method: string;
  params: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function clientWith(handler: (call: RpcCall) => Response | Promise<Response>): Promise<{
  client: NearClientImpl;
  calls: RpcCall[];
}> {
  const calls: RpcCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    const call = { url, method: body.method, params: body.params };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;

  const client = new NearClientImpl(
    'testnet',
    RPC,
    'relay.ci.testnet',
    KeyPair.fromRandom('ed25519').toString(),
    'guard.djume.testnet'
  );
  await client.init();
  return { client, calls };
}

function viewAccessKey(call: RpcCall): Response {
  expect(call.params.request_type).toBe('view_access_key');
  expect(call.params.finality).toBe('optimistic');
  return response({
    result: { nonce: 7, block_hash: BLOCK_HASH, permission: 'FullAccess' },
  });
}

function block(call: RpcCall): Response {
  expect(call.params.finality).toBe('optimistic');
  return response({ result: { header: { hash: BLOCK_HASH } } });
}

function accepted(): Response {
  return response({ result: { final_execution_status: 'NONE' } });
}

async function submit(client: NearClientImpl): Promise<{ txHash: string; pending?: boolean }> {
  return client.submitOwnerAction('msg', [1], '0', '30000000000000');
}

describe('submitOwnerAction signing prep', () => {
  it('reads the access key once, broadcasts once, then only refreshes the block hash', async () => {
    const { client, calls } = await clientWith((call) => {
      expect(call.url).toBe(RPC);
      if (call.method === 'query') return viewAccessKey(call);
      if (call.method === 'block') return block(call);
      expect(call.method).toBe('send_tx');
      expect(call.params.wait_until).toBe('NONE');
      expect(typeof call.params.signed_tx_base64).toBe('string');
      return accepted();
    });

    const first = await submit(client);
    expect(first.pending).toBe(true);
    expect(first.txHash.length).toBeGreaterThan(10);
    expect(calls.map((call) => call.method)).toEqual(['query', 'send_tx']);

    calls.length = 0;
    const second = await submit(client);
    expect(second.pending).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(['block', 'send_tx']);
    expect(calls.filter((call) => call.method === 'send_tx')).toHaveLength(1);
  });

  it('does not broadcast again when send_tx times out, and keeps the nonce', async () => {
    let sends = 0;
    const { client, calls } = await clientWith((call) => {
      if (call.method === 'query') return viewAccessKey(call);
      if (call.method === 'block') return block(call);
      sends += 1;
      throw new Error('aborted');
    });

    await expect(submit(client)).rejects.toThrow(/broadcast timed out/);
    expect(sends).toBe(1);
    expect(calls.filter((call) => call.method === 'send_tx')).toHaveLength(1);

    calls.length = 0;
    await expect(submit(client)).rejects.toThrow(/broadcast timed out/);
    expect(sends).toBe(2);
    expect(calls.map((call) => call.method)).toEqual(['block', 'send_tx']);
  });

  it('re-reads the access key after the node rejects the nonce', async () => {
    const { client, calls } = await clientWith((call) => {
      if (call.method === 'query') return viewAccessKey(call);
      if (call.method === 'block') return block(call);
      return response({ error: { message: 'InvalidNonce' } });
    });

    await expect(submit(client)).rejects.toThrow(/rejected before acceptance/);
    calls.length = 0;
    await expect(submit(client)).rejects.toThrow(/rejected before acceptance/);
    expect(calls.map((call) => call.method)).toEqual(['query', 'send_tx']);
    expect(calls[0]?.params.request_type).toBe('view_access_key');
  });
});
