import { PublicKey } from '@solana/web3.js';
import { Account as NearAccount } from 'near-api-js';
import { VaultView, SignRequestView, Policy, VaultState } from './types';
import { SanaGuardError } from './errors';

const VAULT_STATES: readonly VaultState[] = ['PendingVerification', 'Active'];

function parseVaultState(state: unknown): VaultState {
  if (typeof state === 'string' && (VAULT_STATES as readonly string[]).includes(state)) {
    return state as VaultState;
  }
  throw new SanaGuardError(`Invalid or missing vault state: ${String(state)}`);
}

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
 * Quote integer tokens in JSON source text so u64 values survive as strings.
 * String tokens are left unchanged so both `"123"` and `123` are accepted.
 */
export function parseJsonIntegersAsStrings(text: string): unknown {
  const tokenRe = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const rewritten = text.replace(tokenRe, (token) => {
    if (token.startsWith('"')) {
      return token;
    }
    if (/^-?\d+$/.test(token)) {
      return `"${token}"`;
    }
    return token;
  });
  return JSON.parse(rewritten);
}

/**
 * Parse a u64 that may arrive as a string, number, or bigint.
 * The contract now returns `near_sdk::json_types::U64` (JSON string).
 * Number form is still accepted for older deploys (e.g. f7b736b).
 */
export function parseU64Amount(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'string') {
    if (!/^(0|[1-9]\d*)$/.test(value)) {
      throw new SanaGuardError(`Invalid u64 amount: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new SanaGuardError(`Invalid u64 amount: ${value}`);
    }
    return BigInt(value);
  }
  throw new SanaGuardError(`Invalid u64 amount: ${String(value)}`);
}

/**
 * Parse get_spend_24h raw JSON text without losing precision on u64 amounts.
 * Current contract form is `[["SOL","123"]]`; older deploys emit `[["SOL",123]]`.
 */
export function parseSpend24hJson(text: string): Array<{ mint: string; amount: bigint }> {
  const result = parseJsonIntegersAsStrings(text);
  if (!Array.isArray(result)) {
    throw new SanaGuardError('Invalid get_spend_24h result');
  }
  return result.map((item) => {
    if (!Array.isArray(item) || item.length < 2) {
      throw new SanaGuardError('Invalid get_spend_24h entry');
    }
    const mint = item[0];
    if (typeof mint !== 'string') {
      throw new SanaGuardError('Invalid get_spend_24h mint');
    }
    return { mint, amount: parseU64Amount(item[1]) };
  });
}

/**
 * Sana Guard Views
 * 
 * Read-only queries to the NEAR contract
 */
export class Views {
  constructor(
    private readonly nearAccount: NearAccount,
    private readonly guardContract: string
  ) {}

  private view<T>(methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.nearAccount.viewFunction({
      contractId: this.guardContract,
      methodName,
      args,
    }) as Promise<T>;
  }

  /**
   * Get vault by ID
   */
  async getVault(vaultId: number): Promise<VaultView | null> {
    const result: any = await this.view('get_vault', { vault_id: vaultId });

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
      state: parseVaultState(result.state),
    };
  }

  /**
   * Get sign request by hex ID
   */
  async getRequest(reqIdHex: string): Promise<SignRequestView | null> {
    const result: any = await this.view('get_request', { req_id_hex: reqIdHex });

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
   * Get 24-hour spend totals for a vault.
   * Reads raw JSON so both U64 strings and legacy number amounts parse as bigint.
   */
  async getSpend24h(vaultId: number): Promise<Array<{ mint: string; amount: bigint }>> {
    const text: string = await this.nearAccount.viewFunction({
      contractId: this.guardContract,
      methodName: 'get_spend_24h',
      args: { vault_id: vaultId },
      parse: (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8'),
    });

    return parseSpend24hJson(text);
  }

  /**
   * Get owner nonce (for signing admin messages)
   */
  async getNonce(ownerB58: string): Promise<number> {
    const result: any = await this.view('owner_nonce', { owner_b58: ownerB58 });
    return result;
  }

  /**
   * Get recipients for a vault
   */
  async getRecipients(vaultId: number, fromIndex?: number, limit?: number): Promise<string[]> {
    const result: any = await this.view('get_recipients', {
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
    const result: any = await this.view('list_vaults', { from, limit });

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
        state: parseVaultState(item[1].state),
      },
    }));
  }

  /**
   * Get supported programs
   */
  async supportedPrograms(): Promise<string[]> {
    const result: any = await this.view('supported_programs');
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

    const result: any = await this.nearAccount.viewFunction({
      contractId: mpcContract,
      methodName: 'derived_public_key',
      args: {
        path,
        predecessor: this.guardContract,
        domain_id: mpcDomainId,
      },
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

export { parseVaultState };
