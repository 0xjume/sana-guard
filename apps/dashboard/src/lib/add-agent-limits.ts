import {
  MAX_AGENT_FUNDING,
  MIN_AGENT_FUNDING,
  parseU64Amount,
  parseVaultCount,
} from '@sana-guard/sdk';
import { DASH_MALFORMED_ACTION, parsePositiveInt } from './create-vault-limits';
import { nearToYocto, yoctoToNear } from './format';

export const DASH_AGENT_LIMIT = 'DASH_AGENT_LIMIT';
export const DASH_AGENT_FUNDING = 'DASH_AGENT_FUNDING';
export const MAX_AGENTS_PER_VAULT_MESSAGE = 'Hosted demo allows at most 3 agents per vault';
export const AGENT_LIMIT_UNAVAILABLE = 'Agent limit check unavailable, try again';

export const DEFAULT_MAX_AGENTS_PER_VAULT = 3;
export const DEFAULT_MAX_AGENT_GAS_FUNDING_NEAR = '0.25';

export interface AddAgentLimits {
  maxAgentsPerVault: number;
  maxAgentGasFundingYocto: bigint;
  maxAgentGasFundingNear: string;
  minAgentGasFundingYocto: bigint;
  minAgentGasFundingNear: string;
}

export type AddAgentLimitOk = { ok: true };
export type AddAgentLimitDenial = {
  ok: false;
  status: 400 | 403 | 404;
  code:
    | typeof DASH_AGENT_LIMIT
    | typeof DASH_AGENT_FUNDING
    | typeof DASH_MALFORMED_ACTION
    | 'VAULT_NOT_FOUND';
  message: string;
};
export type AddAgentLimitResult = AddAgentLimitOk | AddAgentLimitDenial;

export interface AddAgentViews {
  getVault(vaultId: number): Promise<{ agents: unknown } | null>;
}

function denyAddAgent(
  code: AddAgentLimitDenial['code'],
  message: string,
  status: AddAgentLimitDenial['status']
): AddAgentLimitDenial {
  return { ok: false, status, code, message };
}

function parseDashboardFundingCap(raw: string | undefined): bigint {
  if (raw === undefined || raw.trim() === '') {
    return nearToYocto(DEFAULT_MAX_AGENT_GAS_FUNDING_NEAR);
  }
  try {
    const yocto = nearToYocto(raw);
    if (yocto >= MIN_AGENT_FUNDING && yocto <= MAX_AGENT_FUNDING) {
      return yocto;
    }
  } catch {
    // Invalid NEAR amounts fall back to the hosted-demo default.
  }
  return nearToYocto(DEFAULT_MAX_AGENT_GAS_FUNDING_NEAR);
}

export function loadAddAgentLimits(
  env: Record<string, string | undefined> = process.env
): AddAgentLimits {
  const maxAgentGasFundingYocto = parseDashboardFundingCap(env.MAX_AGENT_GAS_FUNDING_NEAR);
  return {
    maxAgentsPerVault: parsePositiveInt(env.MAX_AGENTS_PER_VAULT, DEFAULT_MAX_AGENTS_PER_VAULT),
    maxAgentGasFundingYocto,
    maxAgentGasFundingNear: yoctoToNear(maxAgentGasFundingYocto),
    minAgentGasFundingYocto: MIN_AGENT_FUNDING,
    minAgentGasFundingNear: yoctoToNear(MIN_AGENT_FUNDING),
  };
}

export function addAgentActionLimits(
  env: Record<string, string | undefined> = process.env
): Pick<AddAgentLimits, 'maxAgentsPerVault' | 'maxAgentGasFundingNear'> {
  const limits = loadAddAgentLimits(env);
  return {
    maxAgentsPerVault: limits.maxAgentsPerVault,
    maxAgentGasFundingNear: limits.maxAgentGasFundingNear,
  };
}

function addAgentLimitMessage(maxAgentsPerVault: number): string {
  return `Hosted demo allows at most ${maxAgentsPerVault} agents per vault`;
}

export function addAgentUiBlockedReason(
  agentCount: number,
  maxAgentsPerVault: number
): string | null {
  if (agentCount < maxAgentsPerVault) {
    return null;
  }
  return addAgentLimitMessage(maxAgentsPerVault);
}

export function addAgentFundingHint(minNear: string, maxNear: string): string {
  return `Add agent (${minNear}–${maxNear} NEAR)`;
}

type ParsedAddAgent =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'add'; vaultId: number; gasFundingYocto: bigint };

function parseAddAgentAction(message: string): ParsedAddAgent {
  const actionLine = message.split('\n').find((line) => line.startsWith('action: '));
  if (!actionLine) {
    return { kind: 'none' };
  }
  try {
    const action = JSON.parse(actionLine.slice('action: '.length)) as {
      type?: unknown;
      vault_id?: unknown;
      gas_funding?: unknown;
    };
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return { kind: 'malformed' };
    }
    if (action.type !== 'AddAgent') {
      return { kind: 'none' };
    }
    return {
      kind: 'add',
      vaultId: parseVaultCount(action.vault_id, 'vault_id'),
      gasFundingYocto: parseU64Amount(action.gas_funding),
    };
  } catch {
    return { kind: 'malformed' };
  }
}

function evaluateParsedAddAgent(
  parsed: Extract<ParsedAddAgent, { kind: 'add' }>,
  agentCount: number,
  limits: AddAgentLimits
): AddAgentLimitResult {
  if (agentCount >= limits.maxAgentsPerVault) {
    return denyAddAgent(DASH_AGENT_LIMIT, addAgentLimitMessage(limits.maxAgentsPerVault), 403);
  }
  if (
    parsed.gasFundingYocto < limits.minAgentGasFundingYocto ||
    parsed.gasFundingYocto > limits.maxAgentGasFundingYocto
  ) {
    return denyAddAgent(
      DASH_AGENT_FUNDING,
      `AddAgent gas_funding must be between ${limits.minAgentGasFundingNear} and ${limits.maxAgentGasFundingNear} NEAR`,
      400
    );
  }
  return { ok: true };
}

export function evaluateAddAgentLimits(args: {
  message: string;
  agentCount: number;
  limits: AddAgentLimits;
}): AddAgentLimitResult {
  const parsed = parseAddAgentAction(args.message);
  if (parsed.kind === 'none') {
    return { ok: true };
  }
  if (parsed.kind === 'malformed') {
    return denyAddAgent(DASH_MALFORMED_ACTION, 'Malformed owner action', 400);
  }
  return evaluateParsedAddAgent(parsed, args.agentCount, args.limits);
}

export async function checkAddAgentLimits(args: {
  message: string;
  views: AddAgentViews;
  env?: Record<string, string | undefined>;
}): Promise<AddAgentLimitResult> {
  const parsed = parseAddAgentAction(args.message);
  if (parsed.kind === 'none') {
    return { ok: true };
  }
  if (parsed.kind === 'malformed') {
    return denyAddAgent(DASH_MALFORMED_ACTION, 'Malformed owner action', 400);
  }

  const limits = loadAddAgentLimits(args.env);
  const vault = await args.views.getVault(parsed.vaultId);
  if (!vault) {
    return denyAddAgent('VAULT_NOT_FOUND', 'Vault not found', 404);
  }
  if (!Array.isArray(vault.agents)) {
    throw new Error('Invalid get_vault agents');
  }
  return evaluateParsedAddAgent(
    parsed,
    parseVaultCount(vault.agents.length, 'agent count'),
    limits
  );
}
