import { PublicKey } from '@solana/web3.js';
import { Account as NearAccount } from 'near-api-js';
import bs58 from 'bs58';
import { Views } from '../views';

const GUARD = 'guard.djume.testnet';
const MINT = new Uint8Array(32).fill(7);

const rawPolicy = {
  per_tx_limit: [
    ['Sol', '1000000000'],
    [{ Spl: Array.from(MINT) }, 5000],
  ],
  daily_cap: [['Sol', '10000000000']],
  programs: ['11111111111111111111111111111111'],
  max_priority_fee_lamports: '1000000',
  max_total_priority_fee_lamports: null,
  max_memo_len: 100,
  expires_at_ns: '18446744073709551615',
  loosen_delay_ns: '3600000000000',
};

const rawVault = {
  owner: 'Owner111',
  vault_address: 'Vault111',
  path: 'vault/Owner111/0',
  agents: ['bot.guard.djume.testnet'],
  policy: rawPolicy,
  pending_loosen: null,
  paused: false,
  state: 'Active',
};

function viewsWith(responses: Record<string, unknown>): { views: Views; viewFunction: jest.Mock } {
  const viewFunction = jest.fn(async ({ methodName }: { methodName: string }) => {
    if (!(methodName in responses)) throw new Error(`unexpected view ${methodName}`);
    return responses[methodName];
  });
  const views = new Views({ viewFunction } as unknown as NearAccount, GUARD);
  return { views, viewFunction };
}

describe('Views', () => {
  it('getVault parses the raw vault and policy', async () => {
    const { views, viewFunction } = viewsWith({ get_vault: rawVault });

    const vault = await views.getVault(3);

    expect(viewFunction).toHaveBeenCalledWith({
      contractId: GUARD,
      methodName: 'get_vault',
      args: { vault_id: 3 },
    });
    expect(vault?.vaultAddress).toBe('Vault111');
    expect(vault?.state).toBe('Active');
    expect(vault?.pendingLoosen).toBeUndefined();
    expect(vault?.policy.perTxLimit).toEqual([
      { mint: { type: 'sol' }, amount: 1_000_000_000n },
      { mint: { type: 'spl', address: new PublicKey(MINT) }, amount: 5000n },
    ]);
    expect(vault?.policy.expiresAtNs).toBe(18446744073709551615n);
    expect(vault?.policy.maxTotalPriorityFeeLamports).toBeUndefined();
  });

  it('getVault returns null for a missing vault', async () => {
    const { views } = viewsWith({ get_vault: null });
    expect(await views.getVault(9)).toBeNull();
  });

  it('listVaults maps [id, vault] tuples', async () => {
    const pending = {
      ...rawVault,
      pending_loosen: { policy: rawPolicy, effective_ns: '42' },
    };
    const { views } = viewsWith({ list_vaults: [[5, pending]] });

    const [entry] = await views.listVaults(0, 10);

    expect(entry.id).toBe(5);
    expect(entry.vault.pendingLoosen?.effectiveNs).toBe(42n);
  });

  it('getRequest parses spend and drops a null signature', async () => {
    const { views } = viewsWith({
      get_request: {
        vault_id: 1,
        agent: 'bot.guard.djume.testnet',
        msg_hash: 'hash',
        spend: [['SOL', '250']],
        hour: 1000,
        status: { status: 'Pending' },
        signature: null,
        created_ns: '1',
      },
    });

    const req = await views.getRequest('ab'.repeat(32));

    expect(req?.spend).toEqual([{ mint: 'SOL', amount: 250n }]);
    expect(req?.signature).toBeUndefined();
    expect(req?.status).toEqual({ status: 'Pending' });
  });

  it('getNonce, getRecipients and supportedPrograms pass values through', async () => {
    const { views } = viewsWith({
      owner_nonce: 4,
      get_recipients: null,
      supported_programs: ['11111111111111111111111111111111'],
    });

    expect(await views.getNonce('Owner111')).toBe(4);
    expect(await views.getRecipients(0)).toEqual([]);
    expect(await views.supportedPrograms()).toEqual(['11111111111111111111111111111111']);
  });

  it('deriveVaultAddress strips the ed25519: prefix from the MPC result', async () => {
    const key = new Uint8Array(32).fill(9);
    const { views, viewFunction } = viewsWith({
      derived_public_key: `ed25519:${bs58.encode(key)}`,
    });

    const address = await views.deriveVaultAddress('v1.signer-prod.testnet', 'Owner111', 2);

    expect(address.equals(new PublicKey(key))).toBe(true);
    expect(viewFunction).toHaveBeenCalledWith({
      contractId: 'v1.signer-prod.testnet',
      methodName: 'derived_public_key',
      args: { path: 'vault/Owner111/2', predecessor: GUARD, domain_id: 1 },
    });
  });
});
