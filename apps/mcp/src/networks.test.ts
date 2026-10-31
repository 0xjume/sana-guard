import { describe, expect, it } from "vitest";
import { MAINNET_REFUSED_CODE } from "./errors.js";
import {
  SOLANA_GENESIS,
  assertSafeNetworks,
  isNearMainnetAccountId,
  refuseNearMainnetIds,
} from "./networks.js";
import type { GuardConfig } from "./config.js";

function config(overrides: Partial<GuardConfig> = {}): GuardConfig {
  return {
    nearNetwork: "testnet",
    nearRpcUrl: "https://rpc.testnet.near.org",
    guardContractId: "guard.djume.testnet",
    agentAccountId: "agent1.guard.djume.testnet",
    agentPrivateKey: "ed25519:testkey",
    vaultId: 0,
    mpcContract: "v1.signer-prod.testnet",
    mpcDomainId: 1,
    solanaRpcUrl: "https://solana-rpc.publicnode.com",
    allowMainnet: false,
    transport: "stdio",
    httpHost: "127.0.0.1",
    httpPort: 8787,
    httpAllowPublic: false,
    httpAllowedHosts: ["localhost", "127.0.0.1"],
    httpMaxSessions: 32,
    httpSessionTtlMs: 30_000,
    ...overrides,
  };
}

describe("NEAR .near account ids", () => {
  it("treats .near ids as mainnet and refuses them unless allowed", () => {
    expect(isNearMainnetAccountId("guard.near")).toBe(true);
    expect(isNearMainnetAccountId("v1.signer")).toBe(false);
    expect(isNearMainnetAccountId("agent.guard.djume.testnet")).toBe(false);
    expect(() =>
      refuseNearMainnetIds({
        guardContractId: "guard.near",
        agentAccountId: "agent.testnet",
        mpcContract: "v1.signer",
        allowMainnet: false,
      })
    ).toThrow(/mainnet/i);
    expect(() =>
      refuseNearMainnetIds({
        guardContractId: "guard.near",
        agentAccountId: "agent.near",
        mpcContract: "v1.signer",
        allowMainnet: true,
      })
    ).not.toThrow();
  });
});

describe("assertSafeNetworks", () => {
  it("refuses a publicnode/ankr-style Solana mainnet URL via genesis hash", async () => {
    await expect(
      assertSafeNetworks(config({ solanaRpcUrl: "https://solana-rpc.publicnode.com" }), {
        getSolanaGenesisHash: async () => SOLANA_GENESIS.mainnet,
        getNearChainId: async () => "testnet",
      })
    ).rejects.toMatchObject({ code: MAINNET_REFUSED_CODE });

    await expect(
      assertSafeNetworks(config({ solanaRpcUrl: "https://rpc.ankr.com/solana" }), {
        getSolanaGenesisHash: async () => SOLANA_GENESIS.mainnet,
        getNearChainId: async () => "testnet",
      })
    ).rejects.toThrow(/genesis hash is mainnet/);
  });

  it("refuses NEAR chain_id != testnet even when the URL has no 'mainnet' substring", async () => {
    await expect(
      assertSafeNetworks(config({ nearRpcUrl: "https://near.publicnode.com" }), {
        getSolanaGenesisHash: async () => SOLANA_GENESIS.devnet,
        getNearChainId: async () => "mainnet",
      })
    ).rejects.toMatchObject({ code: MAINNET_REFUSED_CODE });
  });

  it("accepts Solana devnet + NEAR testnet and returns the genesis cluster", async () => {
    await expect(
      assertSafeNetworks(config({ solanaRpcUrl: "https://rpc.ankr.com/solana" }), {
        getSolanaGenesisHash: async () => SOLANA_GENESIS.devnet,
        getNearChainId: async () => "testnet",
      })
    ).resolves.toBe("devnet");
  });

  it("allows mainnet genesis and chain_id only with SANA_GUARD_ALLOW_MAINNET", async () => {
    await expect(
      assertSafeNetworks(config({ allowMainnet: true, solanaRpcUrl: "https://rpc.ankr.com/solana" }), {
        getSolanaGenesisHash: async () => SOLANA_GENESIS.mainnet,
        getNearChainId: async () => "mainnet",
      })
    ).resolves.toBe("mainnet-beta");
  });
});
