import { z } from "zod";
import { parseNearToYocto, yoctoToNearString } from "./constants.js";

const configSchema = z.object({
  relayAccountId: z.string().min(1),
  relayPrivateKey: z.string().regex(/^ed25519:/),
  nearNetwork: z.enum(["testnet", "mainnet"]),
  nearRpcUrl: z.string().url(),
  guardContractId: z.string().min(1),
  databaseUrl: z.string().min(1),
  ownerRateLimitPerHour: z.coerce.number().int().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  nodeEnv: z.enum(["development", "production", "test"]),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]),
  inviteToken: z.string().optional(),
  ownerAllowlist: z.string().optional(),
  corsOrigins: z.string().optional(),
  adminGateEnabled: z
    .string()
    .default("true")
    .transform((v) => v !== "false" && v !== "0"),
  trustProxy: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  trustProxyHops: z.coerce.number().int().min(1).max(10),
});

export interface Config extends z.infer<typeof configSchema> {
  relayBalanceFloorYocto: bigint;
  maxAgentGasFundingYocto: bigint;
  globalDailyBudgetYocto: bigint;
  maxDepositPerCallYocto: bigint;
  ownerDailyBudgetYocto: bigint;
}

/** Default per-owner daily budget is 0.3 of the global daily budget. */
export function defaultOwnerDailyBudgetYocto(globalNear: string): bigint {
  return (parseNearToYocto(globalNear, "near") * 3n) / 10n;
}

export function loadConfig(): Config {
  const globalDaily = process.env.GLOBAL_DAILY_BUDGET_NEAR ?? "1.0";
  const parsed = configSchema.parse({
    relayAccountId: process.env.RELAY_ACCOUNT_ID,
    relayPrivateKey: process.env.RELAY_NEAR_PRIVATE_KEY,
    nearNetwork: process.env.NEAR_NETWORK ?? "testnet",
    nearRpcUrl: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
    guardContractId: process.env.GUARD_CONTRACT_ID ?? "guard.djume.testnet",
    databaseUrl: process.env.DATABASE_URL ?? "sqlite:./relay.db",
    ownerRateLimitPerHour: process.env.OWNER_RATE_LIMIT_PER_HOUR ?? "30",
    port: process.env.PORT ?? "3000",
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? "info",
    inviteToken: process.env.INVITE_TOKEN,
    ownerAllowlist: process.env.OWNER_ALLOWLIST,
    corsOrigins: process.env.CORS_ORIGINS,
    adminGateEnabled: process.env.ADMIN_GATE_ENABLED ?? "true",
    trustProxy: process.env.TRUST_PROXY ?? "false",
    trustProxyHops: process.env.TRUST_PROXY_HOPS ?? "1",
  });

  const globalDailyBudgetYocto = parseNearToYocto(globalDaily, "near");
  const ownerDaily =
    process.env.OWNER_DAILY_BUDGET_NEAR ??
    yoctoToNearString(defaultOwnerDailyBudgetYocto(globalDaily));

  return {
    ...parsed,
    relayBalanceFloorYocto: parseNearToYocto(
      process.env.RELAY_BALANCE_FLOOR_NEAR ?? "0.5",
      "near"
    ),
    maxAgentGasFundingYocto: parseNearToYocto(
      process.env.MAX_AGENT_GAS_FUNDING_NEAR ?? "0.5",
      "near"
    ),
    globalDailyBudgetYocto,
    maxDepositPerCallYocto: parseNearToYocto(
      process.env.MAX_DEPOSIT_PER_CALL_NEAR ?? "2.0",
      "near"
    ),
    ownerDailyBudgetYocto: parseNearToYocto(ownerDaily, "near"),
  };
}
