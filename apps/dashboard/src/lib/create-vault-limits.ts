export const DASH_VAULT_LIMIT = 'DASH_VAULT_LIMIT';
export const DASH_RELAY_VAULT_CAP = 'DASH_RELAY_VAULT_CAP';
export const ONE_VAULT_PER_OWNER_MESSAGE = 'One vault per owner on the hosted demo';

export const DEFAULT_MAX_VAULTS_PER_OWNER = 1;
export const DEFAULT_MAX_RELAY_VAULTS_TOTAL = 50;

export type CreateVaultCapMode = 'total';

export interface CreateVaultLimits {
  maxVaultsPerOwner: number;
  maxRelayVaultsTotal: number;
  /** VaultView has no created_at/block, so the hosted demo uses a total cap. */
  capMode: CreateVaultCapMode;
}

export type CreateVaultLimitOk = { ok: true };
export type CreateVaultLimitDenial = {
  ok: false;
  status: 403;
  code: typeof DASH_VAULT_LIMIT | typeof DASH_RELAY_VAULT_CAP;
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
  message: string
): CreateVaultLimitDenial {
  return { ok: false, status: 403, code, message };
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

export function isCreateVaultAdminMessage(message: string): boolean {
  const actionLine = message.split('\n').find((line) => line.startsWith('action: '));
  if (!actionLine) {
    return false;
  }
  try {
    const action = JSON.parse(actionLine.slice('action: '.length)) as { type?: unknown };
    return action.type === 'CreateVault';
  } catch {
    return false;
  }
}

export function createVaultUiBlockedReason(
  ownerVaultCount: number,
  maxVaultsPerOwner: number = DEFAULT_MAX_VAULTS_PER_OWNER
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
  if (!isCreateVaultAdminMessage(args.message)) {
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
    if (page.length === 0) {
      break;
    }
    count += page.length;
    from += page.length;
    if (page.length < LIST_PAGE_SIZE) {
      break;
    }
  }
  return Math.min(count, stopAt);
}

export async function checkCreateVaultLimits(args: {
  message: string;
  owner: string;
  views: CreateVaultViews;
  env?: Record<string, string | undefined>;
}): Promise<CreateVaultLimitResult> {
  if (!isCreateVaultAdminMessage(args.message)) {
    return { ok: true };
  }
  const limits = loadCreateVaultLimits(args.env);
  const ownerVaultCount = await args.views.getOwnerVaultCount(args.owner);
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
    totalVaultCount,
    maxVaultsPerOwner: limits.maxVaultsPerOwner,
    maxRelayVaultsTotal: limits.maxRelayVaultsTotal,
  });
}
