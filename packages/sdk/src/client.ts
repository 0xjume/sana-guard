import { PublicKey, Connection, SendOptions } from '@solana/web3.js';
import { Account as NearAccount } from 'near-api-js';
import { RequestSignParams, BroadcastResult, TransferParams, SignResult, SolanaCluster } from './types';
import { SanaGuardError, createSanaGuardError, toSignError } from './errors';
import {
  buildSolTransfer,
  buildTokenTransfer,
  verifyMessageSignature,
  assembleSignedTransaction,
  assertNotV1Message,
  extractRecentBlockhash,
} from './messages';
import crypto from 'crypto';

interface FunctionCallAccount {
  functionCall(opts: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
    gas: bigint;
    attachedDeposit: bigint;
  }): Promise<unknown>;
  viewFunction(opts: {
    contractId: string;
    methodName: string;
    args: Record<string, unknown>;
  }): Promise<unknown>;
}

function parseSignResult(outcome: unknown): number[] {
  const status = (outcome as { status?: unknown } | null)?.status;
  if (status && typeof status === 'object' && 'SuccessValue' in status) {
    const raw = (status as { SuccessValue: string }).SuccessValue;
    const json = Buffer.from(raw, 'base64').toString('utf8');
    if (!json) {
      throw new SanaGuardError('Empty request_sign result');
    }
    const parsed = JSON.parse(json) as unknown;
    if (parsed == null) {
      throw new SanaGuardError('request_sign returned no signature');
    }
    return parsed as number[];
  }
  if (outcome == null) {
    throw new SanaGuardError('request_sign returned no signature');
  }
  if (Array.isArray(outcome)) {
    if (outcome.length !== 64) {
      throw new SanaGuardError('Invalid MPC signature format');
    }
    return outcome as number[];
  }
  throw createSanaGuardError(JSON.stringify(status ?? outcome));
}

/** Contract req_id_hex: 32 bytes as 64 lowercase hex characters (SG_E058). */
const IDEMPOTENCY_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Validate an idempotency / request id before calling request_sign.
 */
export function validateIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    throw new SanaGuardError(
      'idempotencyKey must be 64 lowercase hex characters (32 bytes)'
    );
  }
}

function resolveRequestId(idempotencyKey?: string): string {
  if (idempotencyKey === undefined) {
    return crypto.randomBytes(32).toString('hex');
  }
  validateIdempotencyKey(idempotencyKey);
  return idempotencyKey;
}

/**
 * Infer the Solana explorer cluster from an RPC URL.
 * Custom / unnamed endpoints stay `custom` and never become mainnet-beta.
 */
export function inferSolanaCluster(rpcUrl: string): SolanaCluster {
  const url = rpcUrl.toLowerCase();
  if (url.includes('devnet')) {
    return 'devnet';
  }
  if (url.includes('testnet')) {
    return 'testnet';
  }
  if (url.includes('mainnet')) {
    return 'mainnet-beta';
  }
  return 'custom';
}

/**
 * Solana explorer URL for a signature on the given cluster.
 */
export function solanaExplorerUrl(
  signature: string,
  cluster: SolanaCluster,
  customRpcUrl?: string
): string {
  if (cluster === 'custom') {
    const custom = customRpcUrl
      ? `&customUrl=${encodeURIComponent(customRpcUrl)}`
      : '';
    return `https://explorer.solana.com/tx/${signature}?cluster=custom${custom}`;
  }
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

/**
 * Pull the NEAR transaction hash out of a functionCall outcome when present.
 */
export function extractNearTxHash(outcome: unknown): string | undefined {
  if (outcome == null || typeof outcome !== 'object') {
    return undefined;
  }
  const record = outcome as {
    transaction?: { hash?: unknown };
    transaction_outcome?: { id?: unknown };
  };
  if (typeof record.transaction?.hash === 'string' && record.transaction.hash.length > 0) {
    return record.transaction.hash;
  }
  if (
    typeof record.transaction_outcome?.id === 'string' &&
    record.transaction_outcome.id.length > 0
  ) {
    return record.transaction_outcome.id;
  }
  return undefined;
}

/**
 * Sana Guard Agent Client
 *
 * Handles request_sign calls with agent function-call key,
 * signature verification, and transaction broadcast.
 */
export class AgentClient {
  constructor(
    private readonly solanaConnection: Connection,
    private readonly nearAccount: NearAccount,
    private readonly guardContract: string,
    private readonly vaultAddress: PublicKey
  ) {}

  /**
   * Request MPC signature for a Solana message
   *
   * @param params - Request parameters
   * @param gasAttached - Gas to attach (default 95 Tgas)
   * @returns Ed25519 signature and the request id (for get_request / Release)
   */
  async requestSign(
    params: RequestSignParams,
    gasAttached: string = '95000000000000'
  ): Promise<SignResult> {
    const { vaultId, message, idempotencyKey } = params;

    assertNotV1Message(message);

    const requestId = resolveRequestId(idempotencyKey);
    const messageB64 = Buffer.from(message).toString('base64');

    const account = this.nearAccount as unknown as FunctionCallAccount;
    let nearTxHash: string | undefined;

    try {
      const outcome = await account.functionCall({
        contractId: this.guardContract,
        methodName: 'request_sign',
        args: {
          vault_id: vaultId,
          message_b64: messageB64,
          req_id_hex: requestId,
        },
        gas: BigInt(gasAttached),
        attachedDeposit: BigInt(0),
      });
      nearTxHash = extractNearTxHash(outcome);
      const result = parseSignResult(outcome);

      if (!result || !Array.isArray(result) || result.length !== 64) {
        throw new SanaGuardError('Invalid MPC signature format');
      }

      const signature = new Uint8Array(result);

      const isValid = await verifyMessageSignature(signature, message, this.vaultAddress);
      if (!isValid) {
        throw new SanaGuardError('Signature verification failed');
      }

      return { signature, requestId, nearTxHash };
    } catch (error: unknown) {
      throw toSignError(error, requestId, nearTxHash);
    }
  }

  /**
   * Request signature and broadcast immediately.
   *
   * Confirms against the signed message's own recent blockhash and the
   * lastValidBlockHeight captured when that blockhash was fetched.
   */
  async requestSignAndBroadcast(
    params: RequestSignParams,
    gasAttached: string = '95000000000000',
    sendOptions: SendOptions = { skipPreflight: false, preflightCommitment: 'confirmed' },
    finalityLevel: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<BroadcastResult> {
    if (params.lastValidBlockHeight === undefined) {
      throw new SanaGuardError(
        'lastValidBlockHeight is required so confirmation uses the signed message blockhash'
      );
    }

    let requestId: string | undefined;
    let nearTxHash: string | undefined;
    try {
      const signed = await this.requestSign(params, gasAttached);
      requestId = signed.requestId;
      nearTxHash = signed.nearTxHash;
      const signedTx = assembleSignedTransaction(signed.signature, params.message);
      const blockhash = extractRecentBlockhash(params.message);

      const txSignature = await this.solanaConnection.sendRawTransaction(signedTx, sendOptions);

      const confirmation = await this.solanaConnection.confirmTransaction(
        {
          signature: txSignature,
          blockhash,
          lastValidBlockHeight: params.lastValidBlockHeight,
        },
        finalityLevel
      );

      const cluster =
        params.explorerCluster ?? inferSolanaCluster(this.solanaConnection.rpcEndpoint);

      return {
        signature: txSignature,
        explorer: solanaExplorerUrl(txSignature, cluster, this.solanaConnection.rpcEndpoint),
        status: confirmation.value.err ? 'failed' : finalityLevel,
        err: confirmation.value.err || undefined,
        nearTxHash,
      };
    } catch (error: unknown) {
      if (requestId) {
        throw toSignError(error, requestId, nearTxHash);
      }
      throw error;
    }
  }

  /**
   * High-level transfer helper
   *
   * Builds the message, fetches a CONFIRMED blockhash, requests signature, and broadcasts.
   */
  async transfer(
    vaultId: number,
    params: TransferParams,
    options: {
      computeUnitLimit?: number;
      computeUnitPrice?: bigint;
      version?: 'legacy' | 'v0';
      memo?: string;
      maxMemoLen?: number;
    } = {}
  ): Promise<BroadcastResult> {
    const { version = 'v0', computeUnitLimit, computeUnitPrice, memo } = options;

    let maxMemoLen = options.maxMemoLen;
    if (memo && maxMemoLen === undefined) {
      maxMemoLen = await this.policyMaxMemoLen(vaultId);
    }

    const { blockhash, lastValidBlockHeight } =
      await this.solanaConnection.getLatestBlockhash('confirmed');

    let message: Uint8Array;

    if (params.lamports !== undefined) {
      message = buildSolTransfer(this.vaultAddress, params.to, params.lamports, blockhash, {
        version,
        computeUnitLimit,
        computeUnitPrice,
        memo,
        maxMemoLen,
      });
    } else if (params.token) {
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const fromTokenAccount = await getAssociatedTokenAddress(
        params.token.mint,
        this.vaultAddress
      );
      const toTokenAccount = await getAssociatedTokenAddress(params.token.mint, params.to);

      message = buildTokenTransfer(
        this.vaultAddress,
        params.to,
        params.token.mint,
        params.token.amount,
        params.token.decimals,
        fromTokenAccount,
        toTokenAccount,
        blockhash,
        {
          version,
          computeUnitLimit,
          computeUnitPrice,
          createAta: false,
          memo,
          maxMemoLen,
        }
      );
    } else {
      throw new SanaGuardError('Either lamports or token must be provided');
    }

    return this.requestSignAndBroadcast({ vaultId, message, lastValidBlockHeight });
  }

  private async policyMaxMemoLen(vaultId: number): Promise<number> {
    const account = this.nearAccount as unknown as FunctionCallAccount;
    const policy = (await account.viewFunction({
      contractId: this.guardContract,
      methodName: 'get_policy',
      args: { vault_id: vaultId },
    })) as { max_memo_len?: number } | null;

    if (policy == null || typeof policy.max_memo_len !== 'number') {
      throw new SanaGuardError('Could not read vault policy max_memo_len');
    }
    return policy.max_memo_len;
  }
}
