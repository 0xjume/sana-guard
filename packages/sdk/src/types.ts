import { PublicKey as SolanaPublicKey } from '@solana/web3.js';

/**
 * Mint type - SOL or SPL token
 */
export type Mint =
  | { type: 'sol' }
  | { type: 'spl'; address: SolanaPublicKey };

/**
 * Policy enforced by the vault
 */
export interface Policy {
  perTxLimit: Array<{ mint: Mint; amount: bigint }>;
  dailyCap: Array<{ mint: Mint; amount: bigint }>;
  programs: string[];
  maxPriorityFeeLamports: bigint;
  maxMemoLen: number;
  expiresAtNs: bigint;
  loosenDelayNs: bigint;
}

/**
 * Vault view returned by get_vault
 */
export interface VaultView {
  owner: string;
  vaultAddress: string;
  path: string;
  agents: string[];
  policy: Policy;
  pendingLoosen?: {
    policy: Policy;
    effectiveNs: bigint;
  };
  paused: boolean;
}

/**
 * Sign request status
 */
export type SignRequestStatus = 
  | { status: 'Pending' }
  | { status: 'Signed' }
  | { status: 'Failed' }
  | { status: 'Released' };

/**
 * Sign request view returned by get_request
 */
export interface SignRequestView {
  vaultId: number;
  agent: string;
  msgHash: string;
  spend: Array<{ mint: string; amount: bigint }>;
  hour: number;
  status: SignRequestStatus;
  signature?: string;
  createdNs: bigint;
}

/**
 * Owner action types for admin messages
 */
export type OwnerAction =
  | {
      type: 'CreateVault';
      owner: string;
      vaultAddress: string;
      policy: Policy;
    }
  | {
      type: 'AddAgent';
      vaultId: number;
      name: string;
      publicKey: string;
      gasFunding: bigint;
    }
  | {
      type: 'RemoveAgent';
      vaultId: number;
      agent: string;
    }
  | {
      type: 'SetPolicy';
      vaultId: number;
      policy: Policy;
    }
  | {
      type: 'AddRecipient';
      vaultId: number;
      recipient: string;
    }
  | {
      type: 'RemoveRecipient';
      vaultId: number;
      recipient: string;
    }
  | {
      type: 'RegisterTokenAccount';
      vaultId: number;
      ata: string;
      mint: string;
      decimals: number;
    }
  | {
      type: 'Pause';
      vaultId: number;
    }
  | {
      type: 'Unpause';
      vaultId: number;
    }
  | {
      type: 'Release';
      vaultId: number;
      reqId: string;
    };

/**
 * Ed25519 signer interface - compatible with Privy embedded wallets
 */
export interface Ed25519Signer {
  publicKey: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

/**
 * Admin message with signature
 */
export interface SignedAdminMessage {
  message: string;
  signature: Uint8Array;
}

/**
 * NEAR contract call result with MPC signature
 */
export interface MpcSignResult {
  signature: number[];
}

/**
 * Transfer instruction parameters
 */
export interface TransferParams {
  to: SolanaPublicKey;
  lamports?: bigint;
  token?: {
    mint: SolanaPublicKey;
    amount: bigint;
    decimals: number;
  };
}

/**
 * Solana message version
 */
export type MessageVersion = 'legacy' | 'v0';

/**
 * Request sign parameters
 */
export interface RequestSignParams {
  vaultId: number;
  message: Uint8Array;
  idempotencyKey?: string;
}

/**
 * Broadcast result
 */
export interface BroadcastResult {
  signature: string;
  explorer: string;
  status?: string;
  err?: unknown;
}
