import { describe, expect, it, vi } from 'vitest';
import {
  DASH_MALFORMED_ACTION,
  DASH_VAULT_LIMIT,
  ONE_VAULT_PER_OWNER_MESSAGE,
  VAULT_LIMIT_UNAVAILABLE,
} from './create-vault-limits';
import { handleOwnerActionPost } from './owner-action-handler';
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
    views?: { getOwnerVaultCount: () => Promise<number>; listVaults: () => Promise<unknown[]> };
    postAdmin?: ReturnType<typeof vi.fn>;
    logError?: ReturnType<typeof vi.fn>;
    env?: Record<string, string | undefined>;
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
    views: overrides.views ?? {
      getOwnerVaultCount: async () => 0,
      listVaults: async () => [],
    },
    postAdmin,
    verify: async () => session,
    allowlist: null,
    env: { MAX_VAULTS_PER_OWNER: '1', MAX_RELAY_VAULTS_TOTAL: '10', ...overrides.env },
    rateStore: new Map(),
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
