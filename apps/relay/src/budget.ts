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
} from "./constants.js";

export function yoctoToNear(yocto: string): number {
  return Number(BigInt(yocto)) / 1e24;
}

export function calculateRequiredDeposit(action: AdminAction): string {
  if (action.type === "CreateVault") {
    return CREATE_VAULT_DEPOSIT.toString();
  }

  if (action.type === "AddAgent") {
    const gasFunding = BigInt(action.gas_funding);

    if (gasFunding < MIN_AGENT_FUNDING) {
      throw new Error(
        `AddAgent gas_funding below minimum of ${yoctoToNear(MIN_AGENT_FUNDING.toString())} NEAR`
      );
    }

    if (gasFunding > MAX_AGENT_FUNDING) {
      throw new Error(
        `AddAgent gas_funding exceeds maximum of ${yoctoToNear(MAX_AGENT_FUNDING.toString())} NEAR`
      );
    }

    const total = gasFunding + AGENT_OVERHEAD;
    return total.toString();
  }

  return "0";
}

export function calculateGas(action: AdminAction): string {
  if (action.type === "AddAgent") {
    return GAS_150_TGAS.toString();
  }
  return GAS_100_TGAS.toString();
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
  const maxDepositYocto = BigInt(config.maxDepositPerCallNear) * 1_000_000_000_000_000_000_000_000n;

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
  const ownerBudgetYocto = BigInt(config.ownerDailyBudgetNear) * 1_000_000_000_000_000_000_000_000n;
  if (ownerNewTotal > ownerBudgetYocto) {
    return {
      allowed: false,
      reason: `Owner daily budget exceeded: ${config.ownerDailyBudgetNear} NEAR`,
    };
  }

  const globalNewTotal = BigInt(globalStats.spentToday) + totalCost;
  const globalBudgetYocto = BigInt(config.globalDailyBudgetNear) * 1_000_000_000_000_000_000_000_000n;
  if (globalNewTotal > globalBudgetYocto) {
    return {
      allowed: false,
      reason: `Global daily budget exceeded: ${config.globalDailyBudgetNear} NEAR`,
    };
  }

  return { allowed: true };
}

export function checkActionLimits(
  action: AdminAction,
  db: RelayDatabase,
  nowMs: number
): BudgetCheck {
  if (action.type === "CreateVault") {
    const count = db.getActionCountToday("CreateVault", nowMs);
    if (count >= 3) {
      return {
        allowed: false,
        reason: "CreateVault daily limit exceeded: 3 per day",
      };
    }
  }

  if (action.type === "AddAgent") {
    const count = db.getActionCountToday("AddAgent", nowMs);
    if (count >= 5) {
      return {
        allowed: false,
        reason: "AddAgent daily limit exceeded: 5 per day",
      };
    }
  }

  return { allowed: true };
}
