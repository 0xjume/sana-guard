import { z } from "zod";

const configSchema = z.object({
  relayAccountId: z.string().min(1),
  relayPrivateKey: z.string().regex(/^ed25519:/),
  nearNetwork: z.enum(["testnet", "mainnet"]),
  nearRpcUrl: z.string().url(),
  guardContractId: z.string().min(1),
  databaseUrl: z.string().min(1),
  relayBalanceFloorNear: z.coerce.number().min(0),
  maxAgentGasFundingNear: z.coerce.number().min(0),
  globalDailyBudgetNear: z.coerce.number().min(0),
  maxDepositPerCallNear: z.coerce.number().min(0),
  ownerRateLimitPerHour: z.coerce.number().int().min(1),
  ownerDailyBudgetNear: z.coerce.number().min(0),
  port: z.coerce.number().int().min(1).max(65535),
  nodeEnv: z.enum(["development", "production", "test"]),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const raw = {
    relayAccountId: process.env.RELAY_ACCOUNT_ID,
    relayPrivateKey: process.env.RELAY_NEAR_PRIVATE_KEY,
    nearNetwork: process.env.NEAR_NETWORK ?? "testnet",
    nearRpcUrl:
      process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
    guardContractId: process.env.GUARD_CONTRACT_ID ?? "guard.djume.testnet",
    databaseUrl: process.env.DATABASE_URL ?? "sqlite:./relay.db",
    relayBalanceFloorNear: process.env.RELAY_BALANCE_FLOOR_NEAR ?? "0.5",
    maxAgentGasFundingNear: process.env.MAX_AGENT_GAS_FUNDING_NEAR ?? "0.5",
    globalDailyBudgetNear: process.env.GLOBAL_DAILY_BUDGET_NEAR ?? "10.0",
    maxDepositPerCallNear: process.env.MAX_DEPOSIT_PER_CALL_NEAR ?? "2.0",
    ownerRateLimitPerHour: process.env.OWNER_RATE_LIMIT_PER_HOUR ?? "30",
    ownerDailyBudgetNear: process.env.OWNER_DAILY_BUDGET_NEAR ?? "5.0",
    port: process.env.PORT ?? "3000",
    nodeEnv: process.env.NODE_ENV ?? "development",
    logLevel: process.env.LOG_LEVEL ?? "info",
  };

  return configSchema.parse(raw);
}
