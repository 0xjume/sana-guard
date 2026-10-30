import { PublicKey } from '@solana/web3.js';
import { Contract, Account as NearAccount } from 'near-api-js';
import { VaultView, SignRequestView, Policy } from './types';
import { SanaGuardError } from './errors';

/**
 * Parse a policy from the contract JSON format
 */
function parsePolicy(policy: any): Policy {
  return {
    perTxLimit: policy.per_tx_limit.map((item: any) => {
      const [mint, amount] = item;
      return {
        mint: typeof mint === 'string' && mint === 'Sol'
          ? { type: 'sol' as const }
          : { type: 'spl' as const, address: new PublicKey(Buffer.from(mint.Spl)) },
        amount: BigInt(amount),
      };
    }),
    dailyCap: policy.daily_cap.map((item: any) => {
      const [mint, amount] = item;
      return {
        mint: typeof mint === 'string' && mint === 'Sol'
          ? { type: 'sol' as const }
          : { type: 'spl' as const, address: new PublicKey(Buffer.from(mint.Spl)) },
        amount: BigInt(amount),
      };
    }),
    programs: policy.programs,
    maxPriorityFeeLamports: BigInt(policy.max_priority_fee_lamports),
    maxTotalPriorityFeeLamports: policy.max_total_priority_fee_lamports !== undefined && policy.max_total_priority_fee_lamports !== null
      ? BigInt(policy.max_total_priority_fee_lamports)
      : undefined,
    maxMemoLen: policy.max_memo_len,
    expiresAtNs: BigInt(policy.expires_at_ns),
    loosenDelayNs: BigInt(policy.loosen_delay_ns),
  };
}

/**
 * Sana Guard Views
 * 
 * Read-only queries to the NEAR contract
 */
export class Views {
  private contract: Contract;

  constructor(
    private readonly nearAccount: NearAccount,
    private readonly guardContract: string
  ) {
    this.contract = new Contract(nearAccount, guardContract, {
      viewMethods: [
        'get_vault',
        'get_policy',
        'get_request',
        'get_spend_24h',
        'get_recipients',
        'list_vaults',
        'supported_programs',
        'owner_nonce',
      ],
      changeMethods: [],
      useLocalViewExecution: false,
    });
  }

  /**
   * Get vault by ID
   */
  async getVault(vaultId: number): Promise<VaultView | null> {
    const result: any = await (this.contract as any).get_vault({ vault_id: vaultId });

    if (!result) {
      return null;
    }

    return {
      owner: result.owner,
      vaultAddress: result.vault_address,
      path: result.path,
      agents: result.agents,
      policy: parsePolicy(result.policy),
      pendingLoosen: result.pending_loosen
        ? {
            policy: parsePolicy(result.pending_loosen.policy),
            effectiveNs: BigInt(result.pending_loosen.effective_ns),
          }
        : undefined,
      paused: result.paused,
      state: result.state || 'Active',
    };
  }

  /**
   * Get sign request by hex ID
   */
  async getRequest(reqIdHex: string): Promise<SignRequestView | null> {
    const result: any = await (this.contract as any).get_request({ req_id_hex: reqIdHex });

    if (!result) {
      return null;
    }

    return {
      vaultId: result.vault_id,
      agent: result.agent,
      msgHash: result.msg_hash,
      spend: result.spend.map((item: any) => ({
        mint: item[0],
        amount: BigInt(item[1]),
      })),
      hour: result.hour,
      status: result.status,
      signature: result.signature,
      createdNs: BigInt(result.created_ns),
    };
  }

  /**
   * Get 24-hour spend totals for a vault
   */
  async getSpend24h(vaultId: number): Promise<Array<{ mint: string; amount: bigint }>> {
    const result: any = await (this.contract as any).get_spend_24h({ vault_id: vaultId });

    return result.map((item: any) => ({
      mint: item[0],
      amount: BigInt(item[1]),
    }));
  }

  /**
   * Get owner nonce (for signing admin messages)
   */
  async getNonce(ownerB58: string): Promise<number> {
    const result: any = await (this.contract as any).owner_nonce({ owner_b58: ownerB58 });
    return result;
  }

  /**
   * Get recipients for a vault
   */
  async getRecipients(vaultId: number, fromIndex?: number, limit?: number): Promise<string[]> {
    const result: any = await (this.contract as any).get_recipients({
      vault_id: vaultId,
      from_index: fromIndex,
      limit,
    });
    return result || [];
  }

  /**
   * List vaults with pagination
   */
  async listVaults(from?: number, limit?: number): Promise<Array<{ id: number; vault: VaultView }>> {
    const result: any = await (this.contract as any).list_vaults({ from, limit });

    return result.map((item: any) => ({
      id: item[0],
      vault: {
        owner: item[1].owner,
        vaultAddress: item[1].vault_address,
        path: item[1].path,
        agents: item[1].agents,
        policy: parsePolicy(item[1].policy),
        pendingLoosen: item[1].pending_loosen
          ? {
              policy: parsePolicy(item[1].pending_loosen.policy),
              effectiveNs: BigInt(item[1].pending_loosen.effective_ns),
            }
          : undefined,
        paused: item[1].paused,
        state: item[1].state || 'Active',
      },
    }));
  }

  /**
   * Get supported programs
   */
  async supportedPrograms(): Promise<string[]> {
    const result: any = await (this.contract as any).supported_programs();
    return result;
  }

  /**
   * Derive vault address via MPC derived_public_key
   * 
   * @param mpcContract - MPC signer contract (e.g. v1.signer-prod.testnet)
   * @param ownerPublicKey - Owner's Solana public key (base58)
   * @param vaultIndex - Vault index (from owner_vault_count)
   * @param mpcDomainId - MPC domain ID (default 1 for testnet)
   * @returns Vault address (Solana PublicKey)
   */
  async deriveVaultAddress(
    mpcContract: string,
    ownerPublicKey: string,
    vaultIndex: number,
    mpcDomainId: number = 1
  ): Promise<PublicKey> {
    const path = `vault/${ownerPublicKey}/${vaultIndex}`;

    const mpc = new Contract(this.nearAccount, mpcContract, {
      viewMethods: ['derived_public_key'],
      changeMethods: [],
      useLocalViewExecution: false,
    });

    const result: any = await (mpc as any).derived_public_key({
      path,
      predecessor: this.guardContract,
      domain_id: mpcDomainId,
    });

    if (!result || typeof result !== 'string' || !result.startsWith('ed25519:')) {
      throw new SanaGuardError('Invalid derived public key format');
    }

    // Parse ed25519:base58 format
    const base58Key = result.slice('ed25519:'.length);
    const bs58 = await import('bs58');
    const keyBytes = bs58.default.decode(base58Key);

    if (keyBytes.length !== 32) {
      throw new SanaGuardError('Invalid derived public key length');
    }

    return new PublicKey(keyBytes);
  }
}
