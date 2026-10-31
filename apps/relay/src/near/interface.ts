export interface NearTransaction {
  txHash: string;
  success: boolean;
  errorMessage?: string;
  tokensBurntYocto?: string;
}

export interface TxStatusResult {
  status: 'success' | 'failure' | 'pending' | 'unknown';
  tokensBurntYocto?: string;
}

export interface VaultInfo {
  owner: string;
  vault_address: string;
  path: string;
  agents: string[];
  policy: {
    per_tx_limit: Array<[string, string]>;
    daily_cap: Array<[string, string]>;
    programs: string[];
    max_priority_fee_lamports: string;
    max_memo_len: number;
    expires_at_ns: string;
    loosen_delay_ns: string;
  };
  pending_loosen?: unknown;
  paused: boolean;
}

export interface SubmitHooks {
  /** Called after the tx is signed and hashed, before broadcast. */
  onSigned?: (txHash: string) => void;
}

export interface NearClient {
  getBalance(): Promise<string>;

  getOwnerNonce(ownerB58: string): Promise<number>;

  /** Next per-owner vault index (`owner_vault_count.get(owner).unwrap_or(0)`). */
  getOwnerVaultCount(ownerB58: string): Promise<number>;

  /**
   * MPC `derived_public_key`. Returns `"ed25519:<b58>"`.
   * `predecessor` must be the guard account; `domain_id` is 1 (Frost/Ed25519).
   */
  getDerivedPublicKey(path: string, predecessor: string): Promise<string>;

  getVault(vaultId: number): Promise<VaultInfo | null>;

  submitOwnerAction(
    msg: string,
    sig: number[],
    depositYocto: string,
    gasAmount: string,
    hooks?: SubmitHooks
  ): Promise<NearTransaction>;

  getTransactionStatus(txHash: string): Promise<TxStatusResult>;
}
