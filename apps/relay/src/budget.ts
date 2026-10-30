import type { Config } from "./config.js";
import type { RelayDatabase } from "./db.js";
import type { AdminAction } from "./validation.js";

const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;

export function nearToYocto(near: number): string {
  const yoctoPerNear = "1000000000000000000000000";
  const nearStr = near.toFixed(24);
  const [whole, decimal = ""] = nearStr.split(".");
  const paddedDecimal = (decimal + "0".repeat(24)).slice(0, 24);
  const result = BigInt(whole! + paddedDecimal);
  return result.toString();
}

export function yoctoToNear(yocto: string): number {
  return Number(BigInt(yocto)) / 1e24;
}

export function calculateRequiredDeposit(
  action: AdminAction,
  config: Config
): string {
  if (action.type === "CreateVault") {
    return nearToYocto(0.5);
  }

  if (action.type === "AddAgent") {
    const gasFunding = BigInt(action.gas_funding);
    const overhead = nearToYocto(0.05);
    const total = gasFunding + BigInt(overhead);

    const maxGas = nearToYocto(config.maxAgentGasFundingNear);
    if (gasFunding > BigInt(maxGas)) {
      throw new Error(
        `AddAgent gas_funding exceeds max of ${config.maxAgentGasFundingNear} NEAR`
      );
    }

    return total.toString();
  }

  return "0";
}

export function estimateGasCost(): string {
  return nearToYocto(0.1);
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

  if (totalCost > BigInt(nearToYocto(config.maxDepositPerCallNear))) {
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
  const ownerBudget = BigInt(nearToYocto(config.ownerDailyBudgetNear));
  if (ownerNewTotal > ownerBudget) {
    return {
      allowed: false,
      reason: `Owner daily budget exceeded: ${config.ownerDailyBudgetNear} NEAR`,
    };
  }

  const globalNewTotal = BigInt(globalStats.spentToday) + totalCost;
  const globalBudget = BigInt(nearToYocto(config.globalDailyBudgetNear));
  if (globalNewTotal > globalBudget) {
    return {
      allowed: false,
      reason: `Global daily budget exceeded: ${config.globalDailyBudgetNear} NEAR`,
    };
  }

  return { allowed: true };
}
