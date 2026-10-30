export interface NearTransaction {
  txHash: string;
  success: boolean;
  errorMessage?: string;
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

export interface NearClient {
  getBalance(): Promise<string>;
  
  getOwnerNonce(ownerB58: string): Promise<number>;
  
  getVault(vaultId: number): Promise<VaultInfo | null>;
  
  submitOwnerAction(
    msg: string,
    sig: number[],
    depositYocto: string
  ): Promise<NearTransaction>;
}
