import { readFileSync } from "node:fs";
import { SanaGuardError } from "@sana-guard/sdk";
import { MAINNET_REFUSED_CODE } from "./errors.js";
import { parseAmountString } from "./amounts.js";

export type NearNetwork = "testnet" | "mainnet";
export type TransportKind = "stdio" | "http";

export interface GuardConfig {
  nearNetwork: NearNetwork;
  nearRpcUrl: string;
  guardContractId: string;
  agentAccountId: string;
  /** Never log or return this. */
  agentPrivateKey: string;
  vaultId: number;
  vaultAddress?: string;
  owner?: string;
  vaultIndex?: number;
  mpcContract: string;
  mpcDomainId: number;
  solanaRpcUrl: string;
  allowMainnet: boolean;
  maxLamportsPerCall?: bigint;
  maxTokenAmountPerCall?: bigint;
  transport: TransportKind;
  httpHost: string;
  httpPort: number;
}

export interface PublicConfig {
  nearNetwork: NearNetwork;
  nearRpcUrl: string;
  guardContractId: string;
  agentAccountId: string;
  vaultId: number;
  vaultAddress?: string;
  owner?: string;
  solanaRpcUrl: string;
  solanaCluster: "devnet" | "testnet" | "mainnet-beta" | "custom";
  allowMainnet: boolean;
  maxLamportsPerCall?: string;
  maxTokenAmountPerCall?: string;
  transport: TransportKind;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function required(name: string): string {
  const value = env(name);
  if (!value) {
    throw new SanaGuardError(`${name} is required`);
  }
  return value;
}

function looksLikeMainnet(nearNetwork: string, solanaRpcUrl: string): boolean {
  if (nearNetwork === "mainnet") {
    return true;
  }
  const url = solanaRpcUrl.toLowerCase();
  return url.includes("mainnet") || url.includes("mainnet-beta");
}

export function solanaCluster(solanaRpcUrl: string): PublicConfig["solanaCluster"] {
  const url = solanaRpcUrl.toLowerCase();
  if (url.includes("devnet")) {
    return "devnet";
  }
  if (url.includes("testnet")) {
    return "testnet";
  }
  if (url.includes("mainnet")) {
    return "mainnet-beta";
  }
  return "custom";
}

function readPrivateKey(): string {
  const fromEnv = env("NEAR_PRIVATE_KEY");
  if (fromEnv) {
    return fromEnv;
  }
  const file = env("NEAR_KEY_FILE");
  if (!file) {
    throw new SanaGuardError("NEAR_PRIVATE_KEY or NEAR_KEY_FILE is required");
  }
  const raw = readFileSync(file, "utf8").trim();
  try {
    const parsed = JSON.parse(raw) as { private_key?: string; privateKey?: string };
    const key = parsed.private_key ?? parsed.privateKey;
    if (typeof key === "string" && key.length > 0) {
      return key;
    }
  } catch {
    if (raw.startsWith("ed25519:")) {
      return raw;
    }
  }
  throw new SanaGuardError("NEAR_KEY_FILE must contain a Near credentials JSON or an ed25519: key");
}

export function loadConfig(envSource: NodeJS.ProcessEnv = process.env): GuardConfig {
  const previous = process.env;
  if (envSource !== process.env) {
    process.env = { ...previous, ...envSource };
  }
  try {
    return loadConfigFromProcess();
  } finally {
    if (envSource !== previous) {
      process.env = previous;
    }
  }
}

function loadConfigFromProcess(): GuardConfig {
  const nearNetwork = (env("NEAR_NETWORK") ?? "testnet") as NearNetwork;
  if (nearNetwork !== "testnet" && nearNetwork !== "mainnet") {
    throw new SanaGuardError("NEAR_NETWORK must be testnet or mainnet");
  }
  const solanaRpcUrl = env("SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
  const allowMainnet = env("SANA_GUARD_ALLOW_MAINNET") === "true";

  if (looksLikeMainnet(nearNetwork, solanaRpcUrl) && !allowMainnet) {
    const err = new SanaGuardError(
      "Mainnet refused. Set SANA_GUARD_ALLOW_MAINNET=true to enable.",
      MAINNET_REFUSED_CODE
    );
    throw err;
  }

  const vaultIdRaw = env("SANA_GUARD_VAULT_ID") ?? env("VAULT_ID") ?? "0";
  const vaultId = Number(vaultIdRaw);
  if (!Number.isInteger(vaultId) || vaultId < 0) {
    throw new SanaGuardError("SANA_GUARD_VAULT_ID must be a non-negative integer");
  }

  const maxLamports = env("SANA_GUARD_MAX_LAMPORTS_PER_CALL");
  const maxToken = env("SANA_GUARD_MAX_TOKEN_AMOUNT_PER_CALL");
  const transportArg = env("MCP_TRANSPORT") ?? "stdio";
  if (transportArg !== "stdio" && transportArg !== "http") {
    throw new SanaGuardError("MCP_TRANSPORT must be stdio or http");
  }

  const vaultIndexRaw = env("SANA_GUARD_VAULT_INDEX");

  return {
    nearNetwork,
    nearRpcUrl: env("NEAR_RPC_URL") ?? "https://rpc.testnet.near.org",
    guardContractId: env("GUARD_CONTRACT_ID") ?? "guard.djume.testnet",
    agentAccountId: required("NEAR_ACCOUNT_ID"),
    agentPrivateKey: readPrivateKey(),
    vaultId,
    vaultAddress: env("SANA_GUARD_VAULT_ADDRESS"),
    owner: env("SANA_GUARD_OWNER"),
    vaultIndex: vaultIndexRaw !== undefined ? Number(vaultIndexRaw) : undefined,
    mpcContract: env("MPC_CONTRACT") ?? "v1.signer-prod.testnet",
    mpcDomainId: Number(env("MPC_DOMAIN_ID") ?? "1"),
    solanaRpcUrl,
    allowMainnet,
    maxLamportsPerCall: maxLamports ? parseAmountString(maxLamports, "SANA_GUARD_MAX_LAMPORTS_PER_CALL") : undefined,
    maxTokenAmountPerCall: maxToken
      ? parseAmountString(maxToken, "SANA_GUARD_MAX_TOKEN_AMOUNT_PER_CALL")
      : undefined,
    transport: transportArg,
    httpHost: env("MCP_HTTP_HOST") ?? "127.0.0.1",
    httpPort: Number(env("MCP_HTTP_PORT") ?? "8787"),
  };
}

export function toPublicConfig(config: GuardConfig): PublicConfig {
  return {
    nearNetwork: config.nearNetwork,
    nearRpcUrl: config.nearRpcUrl,
    guardContractId: config.guardContractId,
    agentAccountId: config.agentAccountId,
    vaultId: config.vaultId,
    vaultAddress: config.vaultAddress,
    owner: config.owner,
    solanaRpcUrl: config.solanaRpcUrl,
    solanaCluster: solanaCluster(config.solanaRpcUrl),
    allowMainnet: config.allowMainnet,
    maxLamportsPerCall: config.maxLamportsPerCall?.toString(),
    maxTokenAmountPerCall: config.maxTokenAmountPerCall?.toString(),
    transport: config.transport,
  };
}
