import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import { connect, keyStores, KeyPair, type Account } from "near-api-js";
import {
  AgentClient,
  Views,
  type BroadcastResult,
  type RequestSignParams,
  type SignRequestView,
  type VaultView,
} from "@sana-guard/sdk";
import { type GuardConfig, type PublicConfig, loadConfig, toPublicConfig } from "./config.js";

export interface GuardViews {
  getVault(vaultId: number): Promise<VaultView | null>;
  getSpend24h(vaultId: number): Promise<Array<{ mint: string; amount: bigint }>>;
  getRecipients(vaultId: number, fromIndex?: number, limit?: number): Promise<string[]>;
  getRequest(reqIdHex: string): Promise<SignRequestView | null>;
}

export interface GuardSigner {
  requestSignAndBroadcast(params: RequestSignParams): Promise<BroadcastResult>;
}

export interface SolanaReads {
  getBalance(address: PublicKey): Promise<bigint>;
  getTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  getMintDecimals(mint: PublicKey): Promise<number>;
  getBlockHeight(): Promise<number>;
}

export interface GuardRuntime {
  config: GuardConfig;
  publicConfig: PublicConfig;
  views: GuardViews;
  client: GuardSigner;
  solana: SolanaReads;
  vaultAddress: PublicKey;
  nowNs(): bigint;
}

export async function createRuntime(config: GuardConfig = loadConfig()): Promise<GuardRuntime> {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(config.agentPrivateKey as Parameters<typeof KeyPair.fromString>[0]);
  await keyStore.setKey(config.nearNetwork, config.agentAccountId, keyPair);

  const near = await connect({
    networkId: config.nearNetwork,
    keyStore,
    nodeUrl: config.nearRpcUrl,
  });
  const account = (await near.account(config.agentAccountId)) as Account;
  const views = new Views(account, config.guardContractId);
  const connection = new Connection(config.solanaRpcUrl, "confirmed");

  let vaultAddressStr = config.vaultAddress;
  if (!vaultAddressStr && config.owner !== undefined) {
    const index = config.vaultIndex ?? config.vaultId;
    vaultAddressStr = (await views.deriveVaultAddress(config.mpcContract, config.owner, index, config.mpcDomainId)).toBase58();
  }
  if (!vaultAddressStr) {
    const vault = await views.getVault(config.vaultId);
    if (!vault) {
      throw new Error(`Vault ${config.vaultId} not found`);
    }
    vaultAddressStr = vault.vaultAddress;
  }

  const vaultAddress = new PublicKey(vaultAddressStr);
  const client = new AgentClient(connection, account, config.guardContractId, vaultAddress);

  return {
    config,
    publicConfig: { ...toPublicConfig(config), vaultAddress: vaultAddressStr },
    views,
    client,
    vaultAddress,
    nowNs: () => BigInt(Date.now()) * 1_000_000n,
    solana: {
      async getBalance(address) {
        return BigInt(await connection.getBalance(address, "confirmed"));
      },
      async getTokenBalance(owner, mint) {
        const ata = await getAssociatedTokenAddress(mint, owner);
        const info = await connection.getTokenAccountBalance(ata, "confirmed").catch(() => null);
        return info ? BigInt(info.value.amount) : 0n;
      },
      async getLatestBlockhash() {
        return connection.getLatestBlockhash("confirmed");
      },
      async getMintDecimals(mint) {
        const mintInfo = await getMint(connection, mint);
        return mintInfo.decimals;
      },
      async getBlockHeight() {
        return connection.getBlockHeight("confirmed");
      },
    },
  };
}
