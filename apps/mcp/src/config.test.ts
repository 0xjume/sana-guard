import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, toPublicConfig } from "./config.js";
import { MAINNET_REFUSED_CODE } from "./errors.js";

const baseEnv = {
  NEAR_NETWORK: "testnet",
  NEAR_RPC_URL: "https://rpc.testnet.near.org",
  GUARD_CONTRACT_ID: "guard.djume.testnet",
  NEAR_ACCOUNT_ID: "agent1.guard.djume.testnet",
  NEAR_PRIVATE_KEY: "ed25519:testkey",
  SANA_GUARD_VAULT_ID: "0",
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
};

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, saved);
});

function withEnv(extra: Record<string, string | undefined>) {
  Object.assign(process.env, baseEnv, extra);
}

describe("loadConfig", () => {
  it("defaults to testnet and solana devnet", () => {
    withEnv({});
    const config = loadConfig();
    expect(config.nearNetwork).toBe("testnet");
    expect(config.solanaRpcUrl).toContain("devnet");
    expect(toPublicConfig(config).agentAccountId).toBe("agent1.guard.djume.testnet");
    expect(JSON.stringify(toPublicConfig(config))).not.toContain("ed25519:testkey");
  });

  it("refuses mainnet Solana unless explicitly allowed", () => {
    withEnv({ SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" });
    expect(() => loadConfig()).toThrow(/Mainnet refused/);
    try {
      loadConfig();
    } catch (error) {
      expect((error as { code?: string }).code).toBe(MAINNET_REFUSED_CODE);
    }
  });

  it("refuses NEAR mainnet unless allowed", () => {
    withEnv({ NEAR_NETWORK: "mainnet" });
    expect(() => loadConfig()).toThrow(/Mainnet refused/);
  });

  it("allows mainnet when SANA_GUARD_ALLOW_MAINNET=true", () => {
    withEnv({
      NEAR_NETWORK: "mainnet",
      SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com",
      SANA_GUARD_ALLOW_MAINNET: "true",
    });
    const config = loadConfig();
    expect(config.allowMainnet).toBe(true);
    expect(config.nearNetwork).toBe("mainnet");
  });

  it("parses per-call max amounts as bigint", () => {
    withEnv({
      SANA_GUARD_MAX_LAMPORTS_PER_CALL: "50000000",
      SANA_GUARD_MAX_TOKEN_AMOUNT_PER_CALL: "1000",
    });
    const config = loadConfig();
    expect(config.maxLamportsPerCall).toBe(50_000_000n);
    expect(config.maxTokenAmountPerCall).toBe(1000n);
  });

  it("refuses .near contract/account ids and NEAR RPC URLs that say mainnet", () => {
    withEnv({ GUARD_CONTRACT_ID: "guard.near" });
    expect(() => loadConfig()).toThrow(/Mainnet refused/);
    withEnv({
      GUARD_CONTRACT_ID: "guard.djume.testnet",
      NEAR_RPC_URL: "https://rpc.mainnet.near.org",
    });
    expect(() => loadConfig()).toThrow(/Mainnet refused/);
  });

  it("does not treat a publicnode Solana URL as mainnet from the hostname alone", () => {
    withEnv({ SOLANA_RPC_URL: "https://solana-rpc.publicnode.com" });
    expect(() => loadConfig()).not.toThrow();
  });

  it("requires MCP_HTTP_TOKEN when HTTP is enabled and refuses 0.0.0.0 without ALLOW_PUBLIC", () => {
    withEnv({ MCP_TRANSPORT: "http" });
    expect(() => loadConfig()).toThrow(/MCP_HTTP_TOKEN is required/);
    withEnv({
      MCP_TRANSPORT: "http",
      MCP_HTTP_TOKEN: "tok",
      MCP_HTTP_HOST: "0.0.0.0",
    });
    expect(() => loadConfig()).toThrow(/0\.0\.0\.0/);
    withEnv({
      MCP_TRANSPORT: "http",
      MCP_HTTP_TOKEN: "tok",
      MCP_HTTP_HOST: "0.0.0.0",
      MCP_HTTP_ALLOW_PUBLIC: "true",
    });
    const config = loadConfig();
    expect(config.httpAllowPublic).toBe(true);
    expect(config.httpToken).toBe("tok");
    expect(JSON.stringify(toPublicConfig(config))).not.toContain("tok");
  });
});
