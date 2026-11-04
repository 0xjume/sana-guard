import { describe, expect, it } from 'vitest';
import {
  broadcastSignedTransaction,
  broadcastTxBody,
  interpretBroadcastResponse,
} from './broadcast.js';

describe('broadcastTxBody', () => {
  it('asks send_tx to return without waiting for execution', () => {
    const body = JSON.parse(broadcastTxBody('AQID')) as {
      method: string;
      params: { wait_until: string; signed_tx_base64: string };
    };
    expect(body.method).toBe('send_tx');
    expect(body.params.wait_until).toBe('NONE');
    expect(body.params.signed_tx_base64).toBe('AQID');
  });
});

describe('interpretBroadcastResponse', () => {
  it('accepts a NONE acknowledgement', () => {
    expect(() =>
      interpretBroadcastResponse({ result: { final_execution_status: 'NONE' } })
    ).not.toThrow();
  });

  it('classifies InvalidNonce so the reservation can be released', () => {
    expect(() =>
      interpretBroadcastResponse({
        error: { data: { TxExecutionError: { InvalidTxError: { InvalidNonce: {} } } } },
      })
    ).toThrow(/rejected before acceptance/);
    try {
      interpretBroadcastResponse({
        error: { message: 'InvalidNonce: expired' },
      });
    } catch (error) {
      expect((error as { type?: string }).type).toBe('InvalidNonce');
    }
  });

  it('does not surface raw RPC text on a timeout payload', () => {
    expect(() =>
      interpretBroadcastResponse({
        error: { message: 'Server error', data: 'Timeout error: secret rpc dump' },
      })
    ).toThrow(/^NEAR broadcast timed out$/);
  });
});

describe('broadcastSignedTransaction', () => {
  it('posts once and does not retry a gateway timeout', async () => {
    let calls = 0;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls += 1;
      const sent = JSON.parse(String(init?.body)) as { params: { wait_until: string } };
      expect(sent.params.wait_until).toBe('NONE');
      return new Response('gateway timeout', { status: 408 });
    };
    await expect(
      broadcastSignedTransaction({
        rpcUrl: 'https://rpc.testnet.near.org',
        signedTxBase64: 'AQID',
        fetchImpl: fetchImpl as typeof fetch,
      })
    ).rejects.toThrow(/timed out/);
    expect(calls).toBe(1);
  });

  it('resolves when the node accepts the transaction', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ result: { final_execution_status: 'NONE' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await expect(
      broadcastSignedTransaction({
        rpcUrl: 'https://rpc.testnet.near.org',
        signedTxBase64: 'AQID',
        fetchImpl: fetchImpl as typeof fetch,
      })
    ).resolves.toBeUndefined();
  });
});
