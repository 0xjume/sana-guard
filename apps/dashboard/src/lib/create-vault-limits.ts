import { parseVaultCount } from '@sana-guard/sdk';

export const DASH_VAULT_LIMIT = 'DASH_VAULT_LIMIT';
export const DASH_RELAY_VAULT_CAP = 'DASH_RELAY_VAULT_CAP';
export const DASH_MALFORMED_ACTION = 'DASH_MALFORMED_ACTION';
export const ONE_VAULT_PER_OWNER_MESSAGE = 'One vault per owner on the hosted demo';
export const VAULT_LIMIT_UNAVAILABLE = 'Vault limit check unavailable, try again';

export const DEFAULT_MAX_VAULTS_PER_OWNER = 1;
export const DEFAULT_MAX_RELAY_VAULTS_TOTAL = 10;

export type CreateVaultCapMode = 'total';
export type AdminActionKind = 'CreateVault' | 'other' | 'malformed' | 'none';

export interface CreateVaultLimits {
  maxVaultsPerOwner: number;
  maxRelayVaultsTotal: number;
  /** VaultView has no created_at/block, so the hosted demo uses a total cap. */
  capMode: CreateVaultCapMode;
}

export type CreateVaultLimitOk = { ok: true };
export type CreateVaultLimitDenial = {
  ok: false;
  status: 400 | 403;
  code: typeof DASH_VAULT_LIMIT | typeof DASH_RELAY_VAULT_CAP | typeof DASH_MALFORMED_ACTION;
  message: string;
};
export type CreateVaultLimitResult = CreateVaultLimitOk | CreateVaultLimitDenial;

export interface CreateVaultViews {
  getOwnerVaultCount(ownerB58: string): Promise<number>;
  listVaults(from?: number, limit?: number): Promise<unknown[]>;
}

const LIST_PAGE_SIZE = 100;

function denyCreateVault(
  code: CreateVaultLimitDenial['code'],
  message: string,
  status: CreateVaultLimitDenial['status'] = 403
): CreateVaultLimitDenial {
  return { ok: false, status, code, message };
}

export function parsePositiveInt(raw: string | undefined | null, fallback: number): number {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

export function loadCreateVaultLimits(
  env: Record<string, string | undefined> = process.env
): CreateVaultLimits {
  return {
    maxVaultsPerOwner: parsePositiveInt(env.MAX_VAULTS_PER_OWNER, DEFAULT_MAX_VAULTS_PER_OWNER),
    maxRelayVaultsTotal: parsePositiveInt(
      env.MAX_RELAY_VAULTS_TOTAL,
      DEFAULT_MAX_RELAY_VAULTS_TOTAL
    ),
    capMode: 'total',
  };
}

export function ownerActionLimits(
  env: Record<string, string | undefined> = process.env
): Pick<CreateVaultLimits, 'maxVaultsPerOwner' | 'maxRelayVaultsTotal'> {
  const limits = loadCreateVaultLimits(env);
  return {
    maxVaultsPerOwner: limits.maxVaultsPerOwner,
    maxRelayVaultsTotal: limits.maxRelayVaultsTotal,
  };
}

export function readAdminActionKind(message: string): AdminActionKind {
  const actionLine = message.split('\n').find((line) => line.startsWith('action: '));
  if (!actionLine) {
    return 'none';
  }
  try {
    const action = JSON.parse(actionLine.slice('action: '.length)) as { type?: unknown };
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return 'malformed';
    }
    return action.type === 'CreateVault' ? 'CreateVault' : 'other';
  } catch {
    return 'malformed';
  }
}

export function isCreateVaultAdminMessage(message: string): boolean {
  return readAdminActionKind(message) === 'CreateVault';
}

export function createVaultUiBlockedReason(
  ownerVaultCount: number,
  maxVaultsPerOwner: number
): string | null {
  if (ownerVaultCount >= maxVaultsPerOwner) {
    return ONE_VAULT_PER_OWNER_MESSAGE;
  }
  return null;
}

export function evaluateCreateVaultLimits(args: {
  message: string;
  ownerVaultCount: number;
  totalVaultCount: number;
  maxVaultsPerOwner: number;
  maxRelayVaultsTotal: number;
}): CreateVaultLimitResult {
  const kind = readAdminActionKind(args.message);
  if (kind === 'malformed') {
    return denyCreateVault(DASH_MALFORMED_ACTION, 'Malformed owner action', 400);
  }
  if (kind !== 'CreateVault') {
    return { ok: true };
  }
  if (args.ownerVaultCount >= args.maxVaultsPerOwner) {
    return denyCreateVault(DASH_VAULT_LIMIT, ONE_VAULT_PER_OWNER_MESSAGE);
  }
  if (args.totalVaultCount >= args.maxRelayVaultsTotal) {
    return denyCreateVault(
      DASH_RELAY_VAULT_CAP,
      `Hosted demo is at the relay vault cap (${args.maxRelayVaultsTotal} total). New vaults are paused.`
    );
  }
  return { ok: true };
}

export async function countListedVaults(
  listVaults: (from: number, limit: number) => Promise<unknown[]>,
  stopAt: number
): Promise<number> {
  let count = 0;
  let from = 0;
  while (count < stopAt) {
    const page = await listVaults(from, LIST_PAGE_SIZE);
    if (!Array.isArray(page)) {
      throw new Error('Invalid list_vaults result');
    }
    if (page.length === 0) {
      break;
    }
    count += page.length;
    from += page.length;
    if (page.length < LIST_PAGE_SIZE) {
      break;
    }
  }
  return parseVaultCount(Math.min(count, stopAt), 'list_vaults count');
}

export async function checkCreateVaultLimits(args: {
  message: string;
  owner: string;
  views: CreateVaultViews;
  env?: Record<string, string | undefined>;
}): Promise<CreateVaultLimitResult> {
  const kind = readAdminActionKind(args.message);
  if (kind === 'malformed') {
    return denyCreateVault(DASH_MALFORMED_ACTION, 'Malformed owner action', 400);
  }
  if (kind !== 'CreateVault') {
    return { ok: true };
  }
  const limits = loadCreateVaultLimits(args.env);
  const ownerVaultCount = parseVaultCount(
    await args.views.getOwnerVaultCount(args.owner),
    'owner_vault_count'
  );
  if (ownerVaultCount >= limits.maxVaultsPerOwner) {
    return denyCreateVault(DASH_VAULT_LIMIT, ONE_VAULT_PER_OWNER_MESSAGE);
  }
  const totalVaultCount = await countListedVaults(
    (from, limit) => args.views.listVaults(from, limit),
    limits.maxRelayVaultsTotal
  );
  return evaluateCreateVaultLimits({
    message: args.message,
    ownerVaultCount,
    totalVaultCount: parseVaultCount(totalVaultCount, 'list_vaults count'),
    maxVaultsPerOwner: limits.maxVaultsPerOwner,
    maxRelayVaultsTotal: limits.maxRelayVaultsTotal,
  });
}

export async function fetchOwnerActionLimits(
  fetcher: typeof fetch = fetch
): Promise<{ maxVaultsPerOwner: number }> {
  const response = await fetcher('/api/owner-action', { method: 'GET' });
  if (!response.ok) {
    throw new Error('Vault limit check unavailable, try again');
  }
  const body = (await response.json()) as { maxVaultsPerOwner?: unknown };
  return {
    maxVaultsPerOwner: parseVaultCount(body.maxVaultsPerOwner, 'maxVaultsPerOwner'),
  };
}
