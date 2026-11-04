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
import { forgetAccessKey, rememberSignedNonce } from './nonceCache.js';
import { broadcastSignedTransaction } from './broadcast.js';
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
    const state = await this.account.state();
    return state.amount;
  }

  async getOwnerNonce(ownerB58: string): Promise<number> {
    const result = await this.account.viewFunction({
      contractId: this.contractId,
      methodName: 'owner_nonce',
      args: { owner_b58: ownerB58 },
    });
    return Number(result);
  }

  async getOwnerVaultCount(ownerB58: string): Promise<number> {
    const result = await this.account.viewFunction({
      contractId: this.contractId,
      methodName: 'owner_vault_count',
      args: { owner_b58: ownerB58 },
    });
    return parseOwnerVaultCount(result);
  }

  async getDerivedPublicKey(path: string, predecessor: string): Promise<string> {
    const result: unknown = await this.account.viewFunction({
      contractId: this.mpcContractId,
      methodName: 'derived_public_key',
      args: { path, predecessor, domain_id: 1 },
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
    const result = await this.account.viewFunction({
      contractId: this.contractId,
      methodName: 'get_vault',
      args: { vault_id: vaultId },
    });
    return result;
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

      // These two reads are independent. Each public-RPC round trip is a few
      // seconds, so they run together instead of one after the other.
      let accessKeyInfo: Awaited<ReturnType<typeof this.account.findAccessKey>>;
      let block: { header: { hash: string } };
      try {
        [accessKeyInfo, block] = await Promise.all([
          this.account.findAccessKey(this.contractId, actions).catch((error: unknown) => {
            throw new PreSignError('Failed to load access key', { cause: error });
          }),
          this.connection.connection.provider
            .block({ finality: 'final' })
            .catch((error: unknown) => {
              throw new PreSignError('Failed to fetch latest block', { cause: error });
            }),
        ]);
      } catch (error: unknown) {
        if (isPreSignError(error)) throw error;
        throw new PreSignError('Failed to prepare transaction', { cause: error });
      }
      if (!accessKeyInfo) {
        throw new PreSignError('No matching access key for the relay account');
      }

      const nonce = BigInt(accessKeyInfo.accessKey.nonce) + 1n;
      const publicKey = accessKeyInfo.publicKey.toString();

      let hashBytes: Uint8Array;
      let signedTx: nearAPI.transactions.SignedTransaction;
      try {
        // Sign locally so the hash exists before any broadcast.
        [hashBytes, signedTx] = await transactions.signTransaction(
          this.contractId,
          nonce,
          actions,
          utils.serialize.base_decode(block.header.hash),
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
        accessKeyInfo.accessKey,
        nonce
      );

      try {
        // Do not use provider.sendTransaction: it long-polls EXECUTED_OPTIMISTIC
        // and retries timeouts. The hash is already known; execution is polled.
        await broadcastSignedTransaction({
          rpcUrl: this.rpcUrl,
          signedTxBase64,
        });
        logger.info({ txHash }, 'NEAR transaction broadcast');
        return { txHash, success: false, pending: true };
      } catch (error: unknown) {
        forgetAccessKey(this.account.accessKeyByPublicKeyCache, publicKey);
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TX_STATUS_TIMEOUT_MS);
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'relay-tx-status',
          method,
          params: {
            tx_hash: txHash,
            sender_account_id: this.accountId,
            wait_until: 'NONE',
          },
        }),
        signal: controller.signal,
      });
      const json = (await res.json()) as TxRpcResponse;
      return parseTxStatusJson(json);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
