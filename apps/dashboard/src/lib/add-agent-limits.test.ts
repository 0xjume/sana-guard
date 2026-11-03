import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_AGENT_FUNDING } from '@sana-guard/sdk';
import {
  DASH_AGENT_FUNDING,
  DASH_AGENT_LIMIT,
  MAX_AGENTS_PER_VAULT_MESSAGE,
  checkAddAgentLimits,
  evaluateAddAgentLimits,
  addAgentUiBlockedReason,
  loadAddAgentLimits,
  addAgentActionLimits,
} from './add-agent-limits';
import { DASH_MALFORMED_ACTION } from './create-vault-limits';
import { nearToYocto } from './format';

const OWNER = 'DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB';

function addAgentMessage(gasFundingYocto: string, vaultId = 0): string {
  return [
    'SANA-GUARD-ADMIN-v1',
    'network: near-testnet',
    'contract: guard.djume.testnet',
    `vault: ${vaultId}`,
    'nonce: 2',
    'expires: 2000000000000000000',
    `action: {"type":"AddAgent","vault_id":${vaultId},"name":"agent1","public_key":"ed25519:abc","gas_funding":"${gasFundingYocto}"}`,
  ].join('\n');
}

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

describe('loadAddAgentLimits', () => {
  it('defaults to 3 agents and 0.25 NEAR funding, inside the relay 0.5 cap', () => {
    expect(loadAddAgentLimits({})).toEqual({
      maxAgentsPerVault: 3,
      maxAgentGasFundingYocto: nearToYocto('0.25'),
      maxAgentGasFundingNear: '0.25',
      minAgentGasFundingYocto: MIN_AGENT_FUNDING,
      minAgentGasFundingNear: '0.15',
    });
    expect(addAgentActionLimits({})).toEqual({
      maxAgentsPerVault: 3,
      maxAgentGasFundingNear: '0.25',
    });
  });

  it('reads MAX_AGENTS_PER_VAULT and MAX_AGENT_GAS_FUNDING_NEAR when in range', () => {
    expect(
      loadAddAgentLimits({
        MAX_AGENTS_PER_VAULT: '2',
        MAX_AGENT_GAS_FUNDING_NEAR: '0.4',
      })
    ).toMatchObject({
      maxAgentsPerVault: 2,
      maxAgentGasFundingNear: '0.4',
      maxAgentGasFundingYocto: nearToYocto('0.4'),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back when funding is below the contract min or above the relay 0.5 cap', () => {
    expect(
      loadAddAgentLimits({
        MAX_AGENT_GAS_FUNDING_NEAR: '0.10',
      }).maxAgentGasFundingNear
    ).toBe('0.25');
    expect(
      loadAddAgentLimits({
        MAX_AGENT_GAS_FUNDING_NEAR: '0.6',
      }).maxAgentGasFundingNear
    ).toBe('0.25');
    expect(
      loadAddAgentLimits({
        MAX_AGENTS_PER_VAULT: '0',
      }).maxAgentsPerVault
    ).toBe(3);
  });

  it('warns when MAX_AGENT_GAS_FUNDING_NEAR is out of [0.15, 0.5] and falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(loadAddAgentLimits({ MAX_AGENT_GAS_FUNDING_NEAR: '0.6' }).maxAgentGasFundingNear).toBe(
      '0.25'
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/MAX_AGENT_GAS_FUNDING_NEAR/),
      expect.anything()
    );
  });
});

describe('evaluateAddAgentLimits', () => {
  const limits = loadAddAgentLimits({});

  it('skips caps for non-AddAgent actions', () => {
    expect(
      evaluateAddAgentLimits({
        message: createVaultMessage(),
        agentCount: 9,
        limits,
      })
    ).toEqual({ ok: true });
  });

  it('rejects when the vault is already at the agent cap', () => {
    expect(
      evaluateAddAgentLimits({
        message: addAgentMessage(MIN_AGENT_FUNDING.toString()),
        agentCount: 3,
        limits,
      })
    ).toEqual({
      ok: false,
      status: 403,
      code: DASH_AGENT_LIMIT,
      message: MAX_AGENTS_PER_VAULT_MESSAGE,
    });
  });

  it('rejects gas_funding above the dashboard cap', () => {
    expect(
      evaluateAddAgentLimits({
        message: addAgentMessage(nearToYocto('0.5').toString()),
        agentCount: 0,
        limits,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: DASH_AGENT_FUNDING,
    });
  });

  it('rejects gas_funding below the contract min', () => {
    expect(
      evaluateAddAgentLimits({
        message: addAgentMessage(nearToYocto('0.10').toString()),
        agentCount: 0,
        limits,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: DASH_AGENT_FUNDING,
    });
  });

  it('allows AddAgent when both caps have room', () => {
    expect(
      evaluateAddAgentLimits({
        message: addAgentMessage(MIN_AGENT_FUNDING.toString()),
        agentCount: 2,
        limits,
      })
    ).toEqual({ ok: true });
  });

  it('rejects a malformed AddAgent action', () => {
    expect(
      evaluateAddAgentLimits({
        message: 'action: {"type":"AddAgent","vault_id":0}',
        agentCount: 0,
        limits,
      })
    ).toMatchObject({
      ok: false,
      status: 400,
      code: DASH_MALFORMED_ACTION,
    });
  });
});

describe('addAgentUiBlockedReason', () => {
  it('uses the supplied server max', () => {
    expect(addAgentUiBlockedReason(2, 3)).toBeNull();
    expect(addAgentUiBlockedReason(3, 3)).toBe(MAX_AGENTS_PER_VAULT_MESSAGE);
    expect(addAgentUiBlockedReason(2, 2)).toBe('Hosted demo allows at most 2 agents per vault');
  });
});

describe('checkAddAgentLimits', () => {
  it('counts agents from the contract vault view', async () => {
    const denied = await checkAddAgentLimits({
      message: addAgentMessage(MIN_AGENT_FUNDING.toString()),
      views: {
        getVault: async () => ({ agents: ['a', 'b', 'c'] }),
      },
      env: {},
    });
    expect(denied).toMatchObject({
      ok: false,
      code: DASH_AGENT_LIMIT,
      message: MAX_AGENTS_PER_VAULT_MESSAGE,
    });
  });

  it('allows AddAgent when the vault has room and funding is in range', async () => {
    await expect(
      checkAddAgentLimits({
        message: addAgentMessage(MIN_AGENT_FUNDING.toString()),
        views: {
          getVault: async () => ({ agents: ['a'] }),
        },
        env: {},
      })
    ).resolves.toEqual({ ok: true });
  });

  it('returns 404 when the vault is missing', async () => {
    await expect(
      checkAddAgentLimits({
        message: addAgentMessage(MIN_AGENT_FUNDING.toString()),
        views: {
          getVault: async () => null,
        },
        env: {},
      })
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it('throws when agents is not an array so the route can 503', async () => {
    await expect(
      checkAddAgentLimits({
        message: addAgentMessage(MIN_AGENT_FUNDING.toString()),
        views: {
          getVault: async () => ({ agents: 'nope' as unknown as string[] }),
        },
        env: {},
      })
    ).rejects.toThrow(/agents/);
  });
});
