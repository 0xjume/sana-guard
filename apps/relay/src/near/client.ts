import * as nearAPI from 'near-api-js';
import { logger } from '../logger.js';
import { Mutex } from '../mutex.js';
import type {
  NearClient,
  NearTransaction,
  SubmitHooks,
  TxStatusResult,
  VaultInfo,
} from './interface.js';
import {
  errorMessage,
  isOnChainExecutionError,
  isPreAcceptanceRejection,
  isPreSignError,
  PreSignError,
} from './errors.js';
import { forgetAccessKey, rememberSignedNonce, shouldForgetAccessKey } from './nonceCache.js';
import { broadcastSignedTransaction } from './broadcast.js';
import { createNearRpc, type NearRpc } from './rpc.js';
import { parseTxStatusJson, type TxRpcResponse } from './txStatus.js';
import { parseOwnerVaultCount } from '../viewCount.js';

const { connect, keyStores, KeyPair, transactions, utils } = nearAPI;

const TX_STATUS_TIMEOUT_MS = 10_000;

export class NearClientImpl implements NearClient {
  private connection!: nearAPI.Near;
  private account!: nearAPI.Account;
  private readonly contractId: string;
  private readonly mpcContractId: string;
  private readonly accountId: string;
  private readonly rpcUrl: string;
  private readonly privateKey: string;
  private readonly submitMutex = new Mutex();
  private readonly rpc: NearRpc;
  private initPromise: Promise<void> | undefined;

  constructor(
    private readonly networkId: string,
    rpcUrl: string,
    accountId: string,
    privateKey: string,
    contractId: string,
    mpcContractId = 'v1.signer-prod.testnet'
  ) {
    this.contractId = contractId;
    this.mpcContractId = mpcContractId;
    this.accountId = accountId;
    this.rpcUrl = rpcUrl;
    this.privateKey = privateKey;
    this.rpc = createNearRpc({ primaryUrl: rpcUrl });
  }

  /**
   * Await keystore + RPC client setup before serving requests.
   * Logs and rethrows on failure so the process can exit instead of listening half-ready.
   */
  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initConnection();
    }
    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = undefined;
      logger.error({ err }, 'Failed to initialize NEAR connection');
      throw err;
    }
  }

  private async initConnection(): Promise<void> {
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(this.privateKey as `ed25519:${string}`);
    await keyStore.setKey(this.networkId, this.accountId, keyPair);

    this.connection = await connect({
      networkId: this.networkId,
      keyStore,
      nodeUrl: this.rpcUrl,
      headers: {},
    });

    this.account = await this.connection.account(this.accountId);
  }

  async getBalance(): Promise<string> {
    const state = await this.rpc.call(
      'query',
      {
        request_type: 'view_account',
        finality: 'optimistic',
        account_id: this.accountId,
      },
      'view_account'
    );
    const amount =
      state && typeof state === 'object' && 'amount' in state
        ? (state as { amount: unknown }).amount
        : null;
    if (typeof amount !== 'string') {
      throw new Error('NEAR RPC error');
    }
    return amount;
  }

  async getOwnerNonce(ownerB58: string): Promise<number> {
    const result = await this.viewCall(this.contractId, 'owner_nonce', { owner_b58: ownerB58 });
    return Number(result);
  }

  async getOwnerVaultCount(ownerB58: string): Promise<number> {
    const result = await this.viewCall(this.contractId, 'owner_vault_count', {
      owner_b58: ownerB58,
    });
    return parseOwnerVaultCount(result);
  }

  async getDerivedPublicKey(path: string, predecessor: string): Promise<string> {
    const result = await this.viewCall(this.mpcContractId, 'derived_public_key', {
      path,
      predecessor,
      domain_id: 1,
    });
    if (typeof result === 'string') {
      return result;
    }
    if (
      result &&
      typeof result === 'object' &&
      'public_key' in result &&
      typeof result.public_key === 'string'
    ) {
      return result.public_key;
    }
    throw new Error('MPC derived_public_key returned unexpected value');
  }

  async getVault(vaultId: number): Promise<VaultInfo | null> {
    const result = await this.viewCall(this.contractId, 'get_vault', { vault_id: vaultId });
    return result as VaultInfo | null;
  }

  async submitOwnerAction(
    msg: string,
    sig: number[],
    depositYocto: string,
    gasAmount: string,
    hooks?: SubmitHooks
  ): Promise<NearTransaction> {
    return this.submitMutex.run(async () => {
      const actions = [
        transactions.functionCall(
          'owner_action',
          { msg, sig },
          BigInt(gasAmount),
          BigInt(depositYocto)
        ),
      ];

      // One raw query for the key (it includes a recent block hash). A cached
      // nonce still needs a block hash, and that is the only extra read.
      // near-api-js findAccessKey/block() retry Timeout up to 12 times.
      let prepared: { publicKey: string; accessKey: { nonce: bigint }; blockHash: string };
      try {
        prepared = await this.prepareSigningMaterial();
      } catch (error: unknown) {
        if (isPreSignError(error)) throw error;
        throw new PreSignError('Failed to prepare transaction', { cause: error });
      }

      const nonce = prepared.accessKey.nonce + 1n;
      const publicKey = prepared.publicKey;

      let hashBytes: Uint8Array;
      let signedTx: nearAPI.transactions.SignedTransaction;
      try {
        // Sign locally so the hash exists before any broadcast.
        [hashBytes, signedTx] = await transactions.signTransaction(
          this.contractId,
          nonce,
          actions,
          utils.serialize.base_decode(prepared.blockHash),
          this.account.connection.signer,
          this.accountId,
          this.networkId
        );
      } catch (error: unknown) {
        throw new PreSignError('Failed to sign transaction', { cause: error });
      }

      const txHash = utils.serialize.base_encode(hashBytes);
      let signedTxBase64: string;
      try {
        signedTxBase64 = Buffer.from(signedTx.encode()).toString('base64');
      } catch (error: unknown) {
        throw new PreSignError('Failed to encode transaction', { cause: error });
      }
      hooks?.onSigned?.(txHash);

      rememberSignedNonce(
        this.account.accessKeyByPublicKeyCache,
        publicKey,
        prepared.accessKey,
        nonce
      );

      try {
        // Do not use provider.sendTransaction: it long-polls EXECUTED_OPTIMISTIC
        // and retries timeouts. The hash is already known; execution is polled.
        const broadcastStarted = Date.now();
        await broadcastSignedTransaction({
          rpcUrl: this.rpc.preferredUrl(),
          signedTxBase64,
          timeoutMs: 4_000,
        });
        logger.info(
          { txHash, step: 'send_tx', ms: Date.now() - broadcastStarted },
          'owner action timing'
        );
        return { txHash, success: false, pending: true };
      } catch (error: unknown) {
        // A timeout may still be in the mempool. Dropping the cached nonce makes
        // the next send re-read the chain and reuse that nonce (InvalidNonce).
        if (shouldForgetAccessKey(error)) {
          forgetAccessKey(this.account.accessKeyByPublicKeyCache, publicKey);
        }
        logger.error({ error, txHash }, 'NEAR transaction failed');
        if (isPreAcceptanceRejection(error)) {
          throw error;
        }
        if (isOnChainExecutionError(error)) {
          return {
            txHash,
            success: false,
            errorMessage: errorMessage(error),
          };
        }
        const wrapped = error instanceof Error ? error : new Error(String(error));
        Object.assign(wrapped, { transaction: { hash: txHash } });
        throw wrapped;
      }
    });
  }

  /**
   * Raw JSON-RPC with a 10s abort. Prefers EXPERIMENTAL_tx_status so
   * receipts (and tokens_burnt) are present even with wait_until NONE.
   */
  async getTransactionStatus(txHash: string): Promise<TxStatusResult> {
    const experimental = await this.rpcTxStatus('EXPERIMENTAL_tx_status', txHash);
    if (experimental) return experimental;
    return (await this.rpcTxStatus('tx', txHash)) ?? { status: 'pending' };
  }

  private async rpcTxStatus(
    method: 'EXPERIMENTAL_tx_status' | 'tx',
    txHash: string
  ): Promise<TxStatusResult | undefined> {
    try {
      const json = await this.rpc.request(
        method,
        {
          tx_hash: txHash,
          sender_account_id: this.accountId,
          wait_until: 'NONE',
        },
        method,
        TX_STATUS_TIMEOUT_MS
      );
      if (!json) return undefined;
      return parseTxStatusJson(json as TxRpcResponse);
    } catch {
      return undefined;
    }
  }

  private async viewCall(
    contractId: string,
    methodName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const result = await this.rpc.call(
      'query',
      {
        request_type: 'call_function',
        finality: 'optimistic',
        account_id: contractId,
        method_name: methodName,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
      methodName
    );
    return decodeViewResult(result);
  }

  /**
   * Nonce comes from the in-memory cache when this process already signed,
   * otherwise from one `view_access_key` (optimistic, so it is not behind a
   * finalized lag). The same response carries a block hash new enough to sign
   * with (validity is 86400 blocks). A warm cache only fetches the hash.
   */
  private async prepareSigningMaterial(): Promise<{
    publicKey: string;
    accessKey: { nonce: bigint };
    blockHash: string;
  }> {
    const key = await this.account.connection.signer.getPublicKey(this.accountId, this.networkId);
    if (!key) {
      throw new PreSignError('No matching access key for the relay account');
    }
    const publicKey = key.toString();
    const cached = this.account.accessKeyByPublicKeyCache[publicKey] as
      { nonce?: bigint } | undefined;
    if (cached && typeof cached.nonce === 'bigint') {
      return {
        publicKey,
        accessKey: { nonce: cached.nonce },
        blockHash: await this.latestBlockHash(),
      };
    }

    let raw: { nonce?: unknown; block_hash?: unknown; permission?: unknown };
    try {
      raw = (await this.rpc.call(
        'query',
        {
          request_type: 'view_access_key',
          finality: 'optimistic',
          account_id: this.accountId,
          public_key: publicKey,
        },
        'access_key'
      )) as { nonce?: unknown; block_hash?: unknown; permission?: unknown };
    } catch (error: unknown) {
      throw new PreSignError('Failed to load access key', { cause: error });
    }

    const blockHash = typeof raw.block_hash === 'string' ? raw.block_hash : '';
    if (!blockHash) {
      throw new PreSignError('Failed to fetch latest block');
    }
    const accessKey = {
      nonce: BigInt(typeof raw.nonce === 'string' || typeof raw.nonce === 'number' ? raw.nonce : 0),
      permission: raw.permission,
    };
    const raced = this.account.accessKeyByPublicKeyCache[publicKey] as
      { nonce?: bigint } | undefined;
    if (raced && typeof raced.nonce === 'bigint') {
      return { publicKey, accessKey: { nonce: raced.nonce }, blockHash };
    }
    this.account.accessKeyByPublicKeyCache[publicKey] = accessKey as never;
    return { publicKey, accessKey, blockHash };
  }

  private async latestBlockHash(): Promise<string> {
    try {
      const block = (await this.rpc.call('block', { finality: 'optimistic' }, 'block')) as {
        header?: { hash?: unknown };
      };
      const hash = block.header?.hash;
      if (typeof hash !== 'string' || hash.length === 0) {
        throw new Error('missing hash');
      }
      return hash;
    } catch (error: unknown) {
      if (isPreSignError(error)) throw error;
      throw new PreSignError('Failed to fetch latest block', { cause: error });
    }
  }
}

function decodeViewResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('result' in result)) {
    throw new Error('NEAR RPC error');
  }
  const raw = (result as { result?: unknown }).result;
  const bytes =
    typeof raw === 'string'
      ? Buffer.from(raw, 'base64')
      : Array.isArray(raw)
        ? Buffer.from(raw)
        : null;
  if (!bytes) {
    throw new Error('NEAR RPC error');
  }
  const text = bytes.toString('utf8');
  if (text.length === 0) return null;
  return JSON.parse(text) as unknown;
}
