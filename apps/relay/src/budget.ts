import type { Config } from "./config.js";
import type { RelayDatabase } from "./db.js";
import type { AdminAction } from "./validation.js";
import {
  CREATE_VAULT_DEPOSIT,
  AGENT_OVERHEAD,
  MIN_AGENT_FUNDING,
  MAX_AGENT_FUNDING,
  GAS_100_TGAS,
  GAS_150_TGAS,
  maxGasCostYocto,
  parseNearToYocto,
  yoctoToNearString,
} from "./constants.js";

export function yoctoToNear(yocto: string): number {
  return Number(BigInt(yocto)) / 1e24;
}

export function addAgentDeposit(
  gasFundingYocto: bigint,
  maxFundingYocto: bigint = MAX_AGENT_FUNDING
): string {
  if (gasFundingYocto < MIN_AGENT_FUNDING) {
    throw new Error(
      `AddAgent gas_funding below minimum of ${yoctoToNearString(MIN_AGENT_FUNDING)} NEAR`
    );
  }
  if (gasFundingYocto > maxFundingYocto) {
    throw new Error(
      `AddAgent gas_funding exceeds maximum of ${yoctoToNearString(maxFundingYocto)} NEAR`
    );
  }
  return (gasFundingYocto + AGENT_OVERHEAD).toString();
}

export function maxAgentFundingYocto(config: Config): bigint {
  return parseNearToYocto(String(config.maxAgentGasFundingNear), "near");
}

export function calculateRequiredDeposit(
  action: AdminAction,
  config?: Config
): string {
  if (action.type === "CreateVault") {
    return CREATE_VAULT_DEPOSIT.toString();
  }

  if (action.type === "AddAgent") {
    const max = config ? maxAgentFundingYocto(config) : MAX_AGENT_FUNDING;
    return addAgentDeposit(BigInt(action.gas_funding), max);
  }

  return "0";
}

export function calculateGas(action: AdminAction): string {
  if (action.type === "AddAgent") {
    return GAS_150_TGAS.toString();
  }
  return GAS_100_TGAS.toString();
}

export function estimateGasCostYocto(action: AdminAction): string {
  return maxGasCostYocto(BigInt(calculateGas(action))).toString();
}

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
}

export function checkBudgets(
  owner: string,
  depositYocto: string,
  gasCostYocto: string,
  db: RelayDatabase,
  config: Config,
  nowMs: number
): BudgetCheck {
  const ownerStats = db.getOwnerStats(owner, nowMs);
  const globalStats = db.getGlobalStats(nowMs);

  const totalCost = BigInt(depositYocto) + BigInt(gasCostYocto);
  const maxDepositYocto = parseNearToYocto(String(config.maxDepositPerCallNear), "near");

  if (totalCost > maxDepositYocto) {
    return {
      allowed: false,
      reason: `Total cost exceeds hard cap of ${config.maxDepositPerCallNear} NEAR`,
    };
  }

  if (ownerStats.requestCount1h >= config.ownerRateLimitPerHour) {
    return {
      allowed: false,
      reason: `Owner rate limit exceeded: ${config.ownerRateLimitPerHour} requests per hour`,
    };
  }

  const ownerNewTotal = BigInt(ownerStats.spentToday) + totalCost;
  const ownerBudgetYocto = parseNearToYocto(String(config.ownerDailyBudgetNear), "near");
  if (ownerNewTotal > ownerBudgetYocto) {
    return {
      allowed: false,
      reason: `Owner daily budget exceeded: ${config.ownerDailyBudgetNear} NEAR`,
    };
  }

  const globalNewTotal = BigInt(globalStats.spentToday) + totalCost;
  const globalBudgetYocto = parseNearToYocto(String(config.globalDailyBudgetNear), "near");
  if (globalNewTotal > globalBudgetYocto) {
    return {
      allowed: false,
      reason: `Global daily budget exceeded: ${config.globalDailyBudgetNear} NEAR`,
    };
  }

  return { allowed: true };
}

const DAILY_ACTION_LIMITS: Partial<
  Record<AdminAction["type"], { limit: number; reason: string }>
> = {
  CreateVault: { limit: 3, reason: "CreateVault daily limit exceeded: 3 per day" },
  AddAgent: { limit: 5, reason: "AddAgent daily limit exceeded: 5 per day" },
};

export function checkActionLimits(
  action: AdminAction,
  db: RelayDatabase,
  nowMs: number
): BudgetCheck {
  const rule = DAILY_ACTION_LIMITS[action.type];
  if (!rule) return { allowed: true };

  if (db.getActionCountToday(action.type, nowMs) >= rule.limit) {
    return { allowed: false, reason: rule.reason };
  }
  return { allowed: true };
}

export function wouldBreachFloor(
  balanceYocto: string,
  depositYocto: string,
  gasCostYocto: string,
  floorYocto: bigint
): boolean {
  const remaining = BigInt(balanceYocto) - BigInt(depositYocto) - BigInt(gasCostYocto);
  return remaining < floorYocto;
}
