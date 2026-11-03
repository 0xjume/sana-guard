import { describe, expect, it } from 'vitest';
import {
  DASH_MALFORMED_ACTION,
  DASH_RELAY_VAULT_CAP,
  DASH_VAULT_LIMIT,
  ONE_VAULT_PER_OWNER_MESSAGE,
  checkCreateVaultLimits,
  countListedVaults,
  createVaultUiBlockedReason,
  evaluateCreateVaultLimits,
  fetchOwnerActionLimits,
  isCreateVaultAdminMessage,
  loadCreateVaultLimits,
  ownerActionLimits,
  readAdminActionKind,
} from './create-vault-limits';

const OWNER = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

function createVaultMessage(owner = OWNER): string {
  return [
    'SANA-GUARD-ADMIN-v1',
    'network: near-testnet',
    'contract: guard.djume.testnet',
    'vault: null',
    'nonce: 1',
    'expires: 2000000000000000000',
    `action: {"type":"CreateVault","owner":"${owner}","vault_address":"Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU"}`,
  ].join('\n');
}

function setPolicyMessage(): string {
  return [
    'SANA-GUARD-ADMIN-v1',
    'network: near-testnet',
    'contract: guard.djume.testnet',
    'vault: 0',
    'nonce: 2',
    'expires: 2000000000000000000',
    'action: {"type":"SetPolicy","vault_id":0}',
  ].join('\n');
}

describe('isCreateVaultAdminMessage', () => {
  it('detects CreateVault from the action line', () => {
    expect(isCreateVaultAdminMessage(createVaultMessage())).toBe(true);
    expect(isCreateVaultAdminMessage(setPolicyMessage())).toBe(false);
    expect(isCreateVaultAdminMessage('not an admin message')).toBe(false);
  });

  it('rejects a malformed action line', () => {
    expect(readAdminActionKind('action: {not-json')).toBe('malformed');
    expect(
      evaluateCreateVaultLimits({
        message: 'action: {not-json',
        ownerVaultCount: 0,
        totalVaultCount: 0,
        maxVaultsPerOwner: 1,
        maxRelayVaultsTotal: 10,
      })
    ).toEqual({
      ok: false,
      status: 400,
      code: DASH_MALFORMED_ACTION,
      message: 'Malformed owner action',
    });
  });
});

describe('loadCreateVaultLimits', () => {
  it('defaults to one vault per owner and a total relay cap of 10', () => {
    expect(loadCreateVaultLimits({})).toEqual({
      maxVaultsPerOwner: 1,
      maxRelayVaultsTotal: 10,
      capMode: 'total',
    });
    expect(ownerActionLimits({})).toEqual({
      maxVaultsPerOwner: 1,
      maxRelayVaultsTotal: 10,
    });
    expect(ownerActionLimits({})).not.toHaveProperty('maxAgentsPerVault');
  });

  it('reads MAX_VAULTS_PER_OWNER and MAX_RELAY_VAULTS_TOTAL', () => {
    expect(
      loadCreateVaultLimits({
        MAX_VAULTS_PER_OWNER: '3',
        MAX_RELAY_VAULTS_TOTAL: '10',
      })
    ).toEqual({
      maxVaultsPerOwner: 3,
      maxRelayVaultsTotal: 10,
      capMode: 'total',
    });
  });

  it('falls back when values are missing or invalid', () => {
    expect(
      loadCreateVaultLimits({
        MAX_VAULTS_PER_OWNER: '0',
        MAX_RELAY_VAULTS_TOTAL: 'nope',
      })
    ).toEqual({
      maxVaultsPerOwner: 1,
      maxRelayVaultsTotal: 10,
      capMode: 'total',
    });
  });

  it('rejects scientific and hex env values instead of Number() coercion', () => {
    expect(
      loadCreateVaultLimits({
        MAX_VAULTS_PER_OWNER: '1e1',
        MAX_RELAY_VAULTS_TOTAL: '0x3',
      })
    ).toEqual({
      maxVaultsPerOwner: 1,
      maxRelayVaultsTotal: 10,
      capMode: 'total',
    });
  });
});

describe('evaluateCreateVaultLimits', () => {
  it('skips caps for non-create actions', () => {
    expect(
      evaluateCreateVaultLimits({
        message: setPolicyMessage(),
        ownerVaultCount: 9,
        totalVaultCount: 9,
        maxVaultsPerOwner: 1,
        maxRelayVaultsTotal: 1,
      })
    ).toEqual({ ok: true });
  });

  it('rejects when the owner already has a vault', () => {
    expect(
      evaluateCreateVaultLimits({
        message: createVaultMessage(),
        ownerVaultCount: 1,
        totalVaultCount: 0,
        maxVaultsPerOwner: 1,
        maxRelayVaultsTotal: 10,
      })
    ).toEqual({
      ok: false,
      status: 403,
      code: DASH_VAULT_LIMIT,
      message: ONE_VAULT_PER_OWNER_MESSAGE,
    });
  });

  it('honors a higher MAX_VAULTS_PER_OWNER', () => {
    expect(
      evaluateCreateVaultLimits({
        message: createVaultMessage(),
        ownerVaultCount: 1,
        totalVaultCount: 0,
        maxVaultsPerOwner: 2,
        maxRelayVaultsTotal: 10,
      })
    ).toEqual({ ok: true });
  });

  it('rejects when the hosted demo total vault cap is reached', () => {
    expect(
      evaluateCreateVaultLimits({
        message: createVaultMessage(),
        ownerVaultCount: 0,
        totalVaultCount: 10,
        maxVaultsPerOwner: 1,
        maxRelayVaultsTotal: 10,
      })
    ).toMatchObject({
      ok: false,
      status: 403,
      code: DASH_RELAY_VAULT_CAP,
    });
  });
});

describe('createVaultUiBlockedReason', () => {
  it('uses the supplied server max, not a hard-coded 1', () => {
    expect(createVaultUiBlockedReason(0, 1)).toBeNull();
    expect(createVaultUiBlockedReason(1, 1)).toBe(ONE_VAULT_PER_OWNER_MESSAGE);
    expect(createVaultUiBlockedReason(1, 2)).toBeNull();
    expect(createVaultUiBlockedReason(2, 2)).toBe(ONE_VAULT_PER_OWNER_MESSAGE);
  });
});

describe('countListedVaults', () => {
  it('stops once the cap is known to be reached', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => i),
      Array.from({ length: 100 }, (_, i) => i + 100),
    ];
    const calls: Array<[number, number]> = [];
    const count = await countListedVaults(async (from, limit) => {
      calls.push([from, limit]);
      const page = pages.shift() ?? [];
      return page.slice(0, limit);
    }, 150);
    expect(count).toBe(150);
    expect(calls).toEqual([
      [0, 100],
      [100, 100],
    ]);
  });
});

describe('checkCreateVaultLimits', () => {
  it('reads owner_vault_count and the listed vault total for create_vault', async () => {
    const views = {
      getOwnerVaultCount: async () => 1,
      listVaults: async () => [{ id: 0 }],
    };
    const denied = await checkCreateVaultLimits({
      message: createVaultMessage(),
      owner: OWNER,
      views,
      env: {},
    });
    expect(denied).toMatchObject({
      ok: false,
      code: DASH_VAULT_LIMIT,
      message: ONE_VAULT_PER_OWNER_MESSAGE,
    });
  });

  it('rejects when the relay total cap is exceeded', async () => {
    const views = {
      getOwnerVaultCount: async () => 0,
      listVaults: async () => Array.from({ length: 10 }, (_, id) => ({ id })),
    };
    const denied = await checkCreateVaultLimits({
      message: createVaultMessage(),
      owner: OWNER,
      views,
      env: {},
    });
    expect(denied).toMatchObject({ ok: false, code: DASH_RELAY_VAULT_CAP });
  });

  it('allows create_vault when both caps have room', async () => {
    const views = {
      getOwnerVaultCount: async () => 0,
      listVaults: async () => [{ id: 0 }],
    };
    await expect(
      checkCreateVaultLimits({
        message: createVaultMessage(),
        owner: OWNER,
        views,
        env: {},
      })
    ).resolves.toEqual({ ok: true });
  });

  it('throws on a malformed owner_vault_count so the route can 503', async () => {
    await expect(
      checkCreateVaultLimits({
        message: createVaultMessage(),
        owner: OWNER,
        views: {
          getOwnerVaultCount: async () => Number.NaN,
          listVaults: async () => [],
        },
        env: {},
      })
    ).rejects.toThrow(/owner_vault_count/);
  });

  it('throws on a malformed list_vaults page so the route can 503', async () => {
    await expect(
      checkCreateVaultLimits({
        message: createVaultMessage(),
        owner: OWNER,
        views: {
          getOwnerVaultCount: async () => 0,
          listVaults: async () => 'nope' as unknown as unknown[],
        },
        env: {},
      })
    ).rejects.toThrow(/list_vaults/);
  });
});

describe('fetchOwnerActionLimits', () => {
  it('reads vault and AddAgent caps from GET /api/owner-action', async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          maxVaultsPerOwner: 3,
          maxRelayVaultsTotal: 10,
          maxAgentsPerVault: 2,
          maxAgentGasFundingNear: '0.4',
        }),
        { status: 200 }
      )) as typeof fetch;
    await expect(fetchOwnerActionLimits(fetcher)).resolves.toEqual({
      maxVaultsPerOwner: 3,
      maxRelayVaultsTotal: 10,
      maxAgentsPerVault: 2,
      maxAgentGasFundingNear: '0.4',
    });
  });
});
