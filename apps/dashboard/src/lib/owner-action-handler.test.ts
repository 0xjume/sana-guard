import { describe, expect, it, vi } from 'vitest';
import { MIN_AGENT_FUNDING } from '@sana-guard/sdk';
import {
  DASH_AGENT_FUNDING,
  DASH_AGENT_LIMIT,
  MAX_AGENTS_PER_VAULT_MESSAGE,
} from './add-agent-limits';
import {
  DASH_MALFORMED_ACTION,
  DASH_VAULT_LIMIT,
  ONE_VAULT_PER_OWNER_MESSAGE,
  VAULT_LIMIT_UNAVAILABLE,
} from './create-vault-limits';
import { nearToYocto } from './format';
import { handleOwnerActionPost, ownerActionLimitsJson } from './owner-action-handler';
import type { PrivySession } from './owner-gate';

const OWNER = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';
const session: PrivySession = {
  userId: 'did:privy:test',
  walletAddresses: [OWNER],
};

function createVaultMessage(): string {
  return [
    'SANA-GUARD-ADMIN-v1',
    'network: near-testnet',
    'contract: guard.djume.testnet',
    'vault: null',
    'nonce: 1',
    'expires: 2000000000000000000',
    `action: {"type":"CreateVault","owner":"${OWNER}","vault_address":"Fkk515Q2ZKeg3aqkcpSwVvFbDVj8VVDesHwWttbtMbgU"}`,
  ].join('\n');
}

function addAgentMessage(gasFundingYocto: string = MIN_AGENT_FUNDING.toString()): string {
  return [
    'SANA-GUARD-ADMIN-v1',
    'network: near-testnet',
    'contract: guard.djume.testnet',
    'vault: 0',
    'nonce: 2',
    'expires: 2000000000000000000',
    `action: {"type":"AddAgent","vault_id":0,"name":"agent1","public_key":"ed25519:abc","gas_funding":"${gasFundingYocto}"}`,
  ].join('\n');
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/owner-action', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function post(
  overrides: {
    message?: string;
    views?: {
      getOwnerVaultCount: () => Promise<number>;
      listVaults: () => Promise<unknown[]>;
      getVault?: (vaultId: number) => Promise<{ agents: string[] } | null>;
    };
    postAdmin?: ReturnType<typeof vi.fn>;
    logError?: ReturnType<typeof vi.fn>;
    env?: Record<string, string | undefined>;
    createVaultInFlight?: Set<string>;
  } = {}
) {
  const postAdmin =
    overrides.postAdmin ?? vi.fn(async () => ({ success: true as const, txHash: 'tx-hash' }));
  const logError = overrides.logError ?? vi.fn();
  const response = await handleOwnerActionPost({
    request: request({
      msg: overrides.message ?? createVaultMessage(),
      owner: OWNER,
      signature: Array.from({ length: 64 }, () => 1),
    }),
    configError: null,
    disableReason: null,
    views: {
      getOwnerVaultCount: async () => 0,
      listVaults: async () => [],
      getVault: async () => ({ agents: [] }),
      ...overrides.views,
    },
    postAdmin,
    verify: async () => session,
    allowlist: null,
    env: { MAX_VAULTS_PER_OWNER: '1', MAX_RELAY_VAULTS_TOTAL: '10', ...overrides.env },
    rateStore: new Map(),
    createVaultInFlight: overrides.createVaultInFlight ?? new Set(),
    ip: '1.2.3.4',
    logError,
  });
  return {
    response,
    postAdmin,
    logError,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe('handleOwnerActionPost create vault limits', () => {
  it('does not call the relay when the owner is over the vault limit', async () => {
    const { response, postAdmin, body } = await post({
      views: {
        getOwnerVaultCount: async () => 1,
        listVaults: async () => [],
      },
    });
    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: ONE_VAULT_PER_OWNER_MESSAGE,
      code: DASH_VAULT_LIMIT,
    });
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('does not call the relay when the total vault cap is exceeded', async () => {
    const { response, postAdmin } = await post({
      views: {
        getOwnerVaultCount: async () => 0,
        listVaults: async () => Array.from({ length: 10 }, (_, id) => ({ id })),
      },
    });
    expect(response.status).toBe(403);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('returns a generic 503 when the NEAR lookup fails and does not echo the error', async () => {
    const { response, postAdmin, logError, body } = await post({
      views: {
        getOwnerVaultCount: async () => {
          throw new Error('NEAR RPC 500 secret-token');
        },
        listVaults: async () => [],
      },
    });
    expect(response.status).toBe(503);
    expect(body.error).toBe(VAULT_LIMIT_UNAVAILABLE);
    expect(JSON.stringify(body)).not.toMatch(/secret-token|NEAR RPC/);
    expect(postAdmin).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      'Vault limit check unavailable',
      expect.objectContaining({ message: 'NEAR RPC 500 secret-token' })
    );
  });

  it('returns a generic 503 when owner_vault_count is malformed', async () => {
    const { response, postAdmin, body } = await post({
      views: {
        getOwnerVaultCount: async () => Number.NaN,
        listVaults: async () => [],
      },
    });
    expect(response.status).toBe(503);
    expect(body.error).toBe(VAULT_LIMIT_UNAVAILABLE);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('returns a generic 503 when owner_vault_count is an empty string, never treating it as 0', async () => {
    const { response, postAdmin, body } = await post({
      views: {
        getOwnerVaultCount: async () => '' as unknown as number,
        listVaults: async () => [],
      },
    });
    expect(response.status).toBe(503);
    expect(body.error).toBe(VAULT_LIMIT_UNAVAILABLE);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('returns a generic 503 when owner_vault_count is fractional', async () => {
    const { response, postAdmin, body } = await post({
      views: {
        getOwnerVaultCount: async () => 1.5,
        listVaults: async () => [],
      },
    });
    expect(response.status).toBe(503);
    expect(body.error).toBe(VAULT_LIMIT_UNAVAILABLE);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('rejects a malformed action line and does not call the relay', async () => {
    const { response, postAdmin, body } = await post({
      message: [
        'SANA-GUARD-ADMIN-v1',
        'network: near-testnet',
        'contract: guard.djume.testnet',
        'vault: null',
        'nonce: 1',
        'expires: 2000000000000000000',
        'action: {not-json',
      ].join('\n'),
    });
    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'Malformed owner action',
      code: DASH_MALFORMED_ACTION,
    });
    expect(postAdmin).not.toHaveBeenCalled();
  });
});

describe('ownerActionLimitsJson', () => {
  it('surfaces vault and AddAgent caps for GET /api/owner-action', () => {
    expect(ownerActionLimitsJson({})).toEqual({
      maxVaultsPerOwner: 1,
      maxRelayVaultsTotal: 10,
      maxAgentsPerVault: 3,
      maxAgentGasFundingNear: '0.25',
    });
  });
});

describe('handleOwnerActionPost AddAgent caps', () => {
  it('does not call the relay when the vault is at the agent cap', async () => {
    const { response, postAdmin, body } = await post({
      message: addAgentMessage(),
      views: {
        getOwnerVaultCount: async () => 1,
        listVaults: async () => [],
        getVault: async () => ({ agents: ['a', 'b', 'c'] }),
      },
    });
    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: MAX_AGENTS_PER_VAULT_MESSAGE,
      code: DASH_AGENT_LIMIT,
    });
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('does not call the relay when gas_funding exceeds the dashboard cap', async () => {
    const { response, postAdmin, body } = await post({
      message: addAgentMessage(nearToYocto('0.5').toString()),
      views: {
        getOwnerVaultCount: async () => 1,
        listVaults: async () => [],
        getVault: async () => ({ agents: [] }),
      },
    });
    expect(response.status).toBe(400);
    expect(body.code).toBe(DASH_AGENT_FUNDING);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('does not call the relay when gas_funding is below the contract min', async () => {
    const { response, postAdmin, body } = await post({
      message: addAgentMessage(nearToYocto('0.10').toString()),
      views: {
        getOwnerVaultCount: async () => 1,
        listVaults: async () => [],
        getVault: async () => ({ agents: [] }),
      },
    });
    expect(response.status).toBe(400);
    expect(body.code).toBe(DASH_AGENT_FUNDING);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('returns 404 when get_vault is missing', async () => {
    const { response, postAdmin } = await post({
      message: addAgentMessage(),
      views: {
        getOwnerVaultCount: async () => 1,
        listVaults: async () => [],
        getVault: async () => null,
      },
    });
    expect(response.status).toBe(404);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('returns a generic 503 when the vault view is unreadable', async () => {
    const { response, postAdmin, body } = await post({
      message: addAgentMessage(),
      views: {
        getOwnerVaultCount: async () => 1,
        listVaults: async () => [],
        getVault: async () => {
          throw new Error('NEAR RPC 500 secret-token');
        },
      },
    });
    expect(response.status).toBe(503);
    expect(JSON.stringify(body)).not.toMatch(/secret-token|NEAR RPC/);
    expect(postAdmin).not.toHaveBeenCalled();
  });

  it('forwards AddAgent when both caps have room', async () => {
    const { response, postAdmin } = await post({
      message: addAgentMessage(),
      views: {
        getOwnerVaultCount: async () => 1,
        listVaults: async () => [],
        getVault: async () => ({ agents: ['a', 'b'] }),
      },
    });
    expect(response.status).toBe(200);
    expect(postAdmin).toHaveBeenCalledOnce();
  });
});

describe('handleOwnerActionPost CreateVault in-flight guard', () => {
  it('returns 409 for a second concurrent CreateVault from the same owner', async () => {
    const createVaultInFlight = new Set<string>();
    let started!: () => void;
    const startedP = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstAdmin = vi.fn(async () => {
      started();
      await held;
      return { success: true as const, txHash: 'tx-1' };
    });
    const secondAdmin = vi.fn(async () => ({ success: true as const, txHash: 'tx-2' }));

    const firstPromise = post({
      postAdmin: firstAdmin,
      createVaultInFlight,
    });
    await startedP;
    const second = await post({
      postAdmin: secondAdmin,
      createVaultInFlight,
    });
    expect(second.response.status).toBe(409);
    expect(second.body.code).toBe('DASH_CREATE_VAULT_IN_FLIGHT');
    expect(secondAdmin).not.toHaveBeenCalled();
    release();
    const first = await firstPromise;
    expect(first.response.status).toBe(200);
    expect(firstAdmin).toHaveBeenCalledOnce();
  });
});
