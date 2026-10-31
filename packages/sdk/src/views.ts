import { PublicKey } from '@solana/web3.js';
import { Account as NearAccount } from 'near-api-js';
import { VaultView, SignRequestView, SignRequestStatus, Policy, VaultState, Mint } from './types';
import { SanaGuardError } from './errors';

const VAULT_STATES: readonly VaultState[] = ['PendingVerification', 'Active'];

function parseVaultState(state: unknown): VaultState {
  if (typeof state === 'string' && (VAULT_STATES as readonly string[]).includes(state)) {
    return state as VaultState;
  }
  throw new SanaGuardError(`Invalid or missing vault state: ${String(state)}`);
}

// Raw JSON shapes returned by the contract's view methods (snake_case, u64 as string or number).
type RawU64 = string | number;
type RawMint = 'Sol' | { Spl: number[] };

interface RawPolicy {
  per_tx_limit: Array<[RawMint, RawU64]>;
  daily_cap: Array<[RawMint, RawU64]>;
  programs: string[];
  max_priority_fee_lamports: RawU64;
  max_total_priority_fee_lamports?: RawU64 | null;
  max_memo_len: number;
  expires_at_ns: RawU64;
  loosen_delay_ns: RawU64;
}

interface RawVaultView {
  owner: string;
  vault_address: string;
  path: string;
  agents: string[];
  policy: RawPolicy;
  pending_loosen?: { policy: RawPolicy; effective_ns: RawU64 } | null;
  paused: boolean;
  state: unknown;
}

interface RawSignRequestView {
  vault_id: number;
  agent: string;
  msg_hash: string;
  spend: Array<[string, RawU64]>;
  hour: number;
  status: SignRequestStatus;
  signature?: string | null;
  created_ns: RawU64;
}

function parseMint(mint: RawMint): Mint {
  return mint === 'Sol'
    ? { type: 'sol' }
    : { type: 'spl', address: new PublicKey(Buffer.from(mint.Spl)) };
}

/**
 * Parse a policy from the contract JSON format
 */
function parsePolicy(policy: RawPolicy): Policy {
  return {
    perTxLimit: policy.per_tx_limit.map(([mint, amount]) => ({
      mint: parseMint(mint),
      amount: BigInt(amount),
    })),
    dailyCap: policy.daily_cap.map(([mint, amount]) => ({
      mint: parseMint(mint),
      amount: BigInt(amount),
    })),
    programs: policy.programs,
    maxPriorityFeeLamports: BigInt(policy.max_priority_fee_lamports),
    maxTotalPriorityFeeLamports:
      policy.max_total_priority_fee_lamports !== undefined &&
      policy.max_total_priority_fee_lamports !== null
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
 * Parse get_spend_24h raw JSON text without losing precision on u64 numbers.
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
function parseVaultView(raw: RawVaultView): VaultView {
  return {
    owner: raw.owner,
    vaultAddress: raw.vault_address,
    path: raw.path,
    agents: raw.agents,
    policy: parsePolicy(raw.policy),
    pendingLoosen: raw.pending_loosen
      ? {
          policy: parsePolicy(raw.pending_loosen.policy),
          effectiveNs: BigInt(raw.pending_loosen.effective_ns),
        }
      : undefined,
    paused: raw.paused,
    state: parseVaultState(raw.state),
  };
}

export class Views {
  constructor(
    private readonly nearAccount: NearAccount,
    private readonly guardContract: string
  ) {}

  private view<T>(methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.nearAccount.viewFunction({ contractId: this.guardContract, methodName, args });
  }

  /**
   * Get vault by ID
   */
  async getVault(vaultId: number): Promise<VaultView | null> {
    const result = await this.view<RawVaultView | null>('get_vault', { vault_id: vaultId });
    return result ? parseVaultView(result) : null;
  }

  /**
   * Get sign request by hex ID
   */
  async getRequest(reqIdHex: string): Promise<SignRequestView | null> {
    const result = await this.view<RawSignRequestView | null>('get_request', {
      req_id_hex: reqIdHex,
    });

    if (!result) {
      return null;
    }

    return {
      vaultId: result.vault_id,
      agent: result.agent,
      msgHash: result.msg_hash,
      spend: result.spend.map(([mint, amount]) => ({ mint, amount: BigInt(amount) })),
      hour: result.hour,
      status: result.status,
      signature: result.signature ?? undefined,
      createdNs: BigInt(result.created_ns),
    };
  }

  /**
   * Get 24-hour spend totals for a vault
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
    return this.view<number>('owner_nonce', { owner_b58: ownerB58 });
  }

  /**
   * Get recipients for a vault
   */
  async getRecipients(vaultId: number, fromIndex?: number, limit?: number): Promise<string[]> {
    const result = await this.view<string[] | null>('get_recipients', {
      vault_id: vaultId,
      from_index: fromIndex,
      limit,
    });
    return result || [];
  }

  /**
   * List vaults with pagination
   */
  async listVaults(
    from?: number,
    limit?: number
  ): Promise<Array<{ id: number; vault: VaultView }>> {
    const result = await this.view<Array<[number, RawVaultView]>>('list_vaults', { from, limit });
    return result.map(([id, vault]) => ({ id, vault: parseVaultView(vault) }));
  }

  /**
   * Get supported programs
   */
  async supportedPrograms(): Promise<string[]> {
    return this.view<string[]>('supported_programs');
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

    const result: unknown = await this.nearAccount.viewFunction({
      contractId: mpcContract,
      methodName: 'derived_public_key',
      args: { path, predecessor: this.guardContract, domain_id: mpcDomainId },
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
