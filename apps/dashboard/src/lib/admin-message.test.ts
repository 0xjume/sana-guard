import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  addAgentAction,
  pauseAction,
  setPolicyAction,
  type Ed25519Signer,
  type Policy,
} from '@sana-guard/sdk';
import { describeAdminMessage } from './admin-message';

/** Captures the exact bytes the SDK asks the wallet to sign. */
function capturingSigner(): { signer: Ed25519Signer; signed: () => string } {
  let last: Uint8Array = new Uint8Array();
  return {
    signer: {
      publicKey: new Uint8Array(32),
      sign: async (message) => {
        last = message;
        return new Uint8Array(64);
      },
    },
    signed: () => new TextDecoder().decode(last),
  };
}

const MINT = new PublicKey(new Uint8Array(32).fill(7));

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    perTxLimit: [
      { mint: { type: 'sol' }, amount: 50_000_000n },
      { mint: { type: 'spl', address: MINT }, amount: 1_000n },
    ],
    dailyCap: [{ mint: { type: 'sol' }, amount: 100_000_000n }],
    programs: ['11111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111'],
    maxPriorityFeeLamports: 1n,
    maxTotalPriorityFeeLamports: 1_000_000n,
    maxMemoLen: 64,
    expiresAtNs: 1_800_000_000_000_000_000n,
    loosenDelayNs: 3_600_000_000_000n,
    ...overrides,
  };
}

describe('describeAdminMessage', () => {
  it('decodes a SetPolicy message built by the SDK into readable rows', async () => {
    const { signer, signed } = capturingSigner();
    await setPolicyAction('near-testnet', 'guard.djume.testnet', 3, 9, policy(), signer);

    const review = describeAdminMessage(signed());

    expect(review.title).toBe('Change vault policy');
    expect(review.vault).toBe('#3');
    expect(review.nonce).toBe('9');
    expect(review.contract).toBe('guard.djume.testnet');
    const rows = Object.fromEntries(review.rows.map((row) => [row.label, row.value]));
    expect(rows['Per-tx limit (SOL)']).toBe('0.05 SOL');
    expect(rows['24h cap (SOL)']).toBe('0.1 SOL');
    expect(
      Object.keys(rows).some(
        (label) => label.startsWith('Per-tx limit (') && label !== 'Per-tx limit (SOL)'
      )
    ).toBe(true);
    expect(rows['Allowed programs']).toBe('System, Compute Budget');
    expect(rows['Max compute-unit price']).toBe('1 lamports / CU');
    expect(rows['Max total priority fee / tx']).toBe('0.001 SOL');
    expect(review.warnings).toEqual([]);
  });

  it('warns when there is no total priority fee cap', async () => {
    const { signer, signed } = capturingSigner();
    await setPolicyAction(
      'near-testnet',
      'guard.djume.testnet',
      0,
      1,
      policy({ maxPriorityFeeLamports: 100_000n, maxTotalPriorityFeeLamports: undefined }),
      signer
    );

    const review = describeAdminMessage(signed());

    expect(review.warnings).toHaveLength(1);
    expect(review.warnings[0]).toContain('up to 140 SOL');
  });

  it('describes AddAgent and Pause', async () => {
    const agent = capturingSigner();
    await addAgentAction(
      'near-testnet',
      'guard.djume.testnet',
      2,
      {
        vaultId: 0,
        name: 'bot',
        publicKey: 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp',
        gasFunding: 200_000_000_000_000_000_000_000n,
      },
      agent.signer
    );
    const addReview = describeAdminMessage(agent.signed());
    const addRows = Object.fromEntries(addReview.rows.map((row) => [row.label, row.value]));
    expect(addReview.title).toBe('Add an agent');
    expect(addRows['Agent account']).toBe('bot.guard.djume.testnet');
    expect(addRows['Gas funding']).toBe('0.2 NEAR');

    const pause = capturingSigner();
    await pauseAction('near-testnet', 'guard.djume.testnet', 5, 3, pause.signer);
    const pauseReview = describeAdminMessage(pause.signed());
    expect(pauseReview.title).toBe('Pause vault (kill switch)');
    expect(pauseReview.vault).toBe('#5');
  });

  it('rejects text that is not an admin message', () => {
    expect(() => describeAdminMessage('hello')).toThrow('Not a SANA-GUARD-ADMIN-v1 message');
    expect(() =>
      describeAdminMessage(
        'SANA-GUARD-ADMIN-v1\nnetwork: near-testnet\ncontract: g\nvault: 0\nnonce: 1\nexpires: 1\nnope'
      )
    ).toThrow('missing "action:"');
  });
});
