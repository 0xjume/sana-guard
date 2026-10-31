import { SanaGuardError, type SolanaCluster } from "@sana-guard/sdk";
import { MAINNET_REFUSED_CODE } from "./errors.js";
import type { GuardConfig } from "./config.js";

export const SOLANA_GENESIS = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;

export interface NetworkProbes {
  getSolanaGenesisHash(rpcUrl: string): Promise<string>;
  getNearChainId(rpcUrl: string): Promise<string>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function isNearMainnetAccountId(id: string): boolean {
  return id.toLowerCase().endsWith(".near");
}

export function refuseNearMainnetIds(config: Pick<
  GuardConfig,
  "guardContractId" | "agentAccountId" | "mpcContract" | "allowMainnet"
>): void {
  if (config.allowMainnet) {
    return;
  }
  const ids = [
    ["GUARD_CONTRACT_ID", config.guardContractId],
    ["NEAR_ACCOUNT_ID", config.agentAccountId],
    ["MPC_CONTRACT", config.mpcContract],
  ] as const;
  for (const [label, id] of ids) {
    if (isNearMainnetAccountId(id)) {
      throw new SanaGuardError(
        `${label} ${id} looks like a mainnet .near account. Set SANA_GUARD_ALLOW_MAINNET=true to enable.`,
        MAINNET_REFUSED_CODE
      );
    }
  }
}

export async function defaultNetworkProbes(): Promise<NetworkProbes> {
  return {
    async getSolanaGenesisHash(rpcUrl: string) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] }),
      });
      const body: unknown = await response.json();
      const result = asRecord(body)?.result;
      if (typeof result !== "string" || result.length === 0) {
        throw new SanaGuardError("Could not read Solana genesis hash from RPC");
      }
      return result;
    },
    async getNearChainId(rpcUrl: string) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sana-guard",
          method: "status",
          params: [],
        }),
      });
      const body: unknown = await response.json();
      const result = asRecord(asRecord(body)?.result);
      const chainId = result?.chain_id;
      if (typeof chainId !== "string" || chainId.length === 0) {
        throw new SanaGuardError("Could not read NEAR status chain_id from RPC");
      }
      return chainId;
    },
  };
}

export function clusterFromGenesis(genesis: string): SolanaCluster {
  if (genesis === SOLANA_GENESIS.devnet) {
    return "devnet";
  }
  if (genesis === SOLANA_GENESIS.testnet) {
    return "testnet";
  }
  if (genesis === SOLANA_GENESIS.mainnet) {
    return "mainnet-beta";
  }
  return "custom";
}

export async function assertSafeNetworks(
  config: GuardConfig,
  probes: NetworkProbes
): Promise<SolanaCluster> {
  refuseNearMainnetIds(config);

  const [genesis, chainId] = await Promise.all([
    probes.getSolanaGenesisHash(config.solanaRpcUrl),
    probes.getNearChainId(config.nearRpcUrl),
  ]);

  const cluster = clusterFromGenesis(genesis);
  const solanaIsMainnet = genesis === SOLANA_GENESIS.mainnet;
  const solanaUnknown = cluster === "custom";
  const nearIsTestnet = chainId === "testnet";

  if (!config.allowMainnet) {
    if (solanaIsMainnet) {
      throw new SanaGuardError(
        `Solana RPC genesis hash is mainnet (${genesis}). Set SANA_GUARD_ALLOW_MAINNET=true to enable.`,
        MAINNET_REFUSED_CODE
      );
    }
    if (solanaUnknown) {
      throw new SanaGuardError(
        `Solana RPC genesis hash ${genesis} is not devnet or testnet. Set SANA_GUARD_ALLOW_MAINNET=true to enable.`,
        MAINNET_REFUSED_CODE
      );
    }
    if (!nearIsTestnet) {
      throw new SanaGuardError(
        `NEAR RPC chain_id is ${chainId}, not testnet. Set SANA_GUARD_ALLOW_MAINNET=true to enable.`,
        MAINNET_REFUSED_CODE
      );
    }
  }

  return cluster;
}
