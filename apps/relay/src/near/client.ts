import * as nearAPI from "near-api-js";
import { logger } from "../logger.js";
import { Mutex } from "../mutex.js";
import type {
  NearClient,
  NearTransaction,
  SubmitHooks,
  TxStatusResult,
  VaultInfo,
} from "./interface.js";
import {
  errorMessage,
  isOnChainExecutionError,
  isPreAcceptanceRejection,
} from "./errors.js";

const { connect, keyStores, KeyPair, transactions, utils } = nearAPI;

const TX_STATUS_TIMEOUT_MS = 10_000;

export class NearClientImpl implements NearClient {
  private connection!: nearAPI.Near;
  private account!: nearAPI.Account;
  private readonly contractId: string;
  private readonly accountId: string;
  private readonly rpcUrl: string;
  private readonly submitMutex = new Mutex();

  constructor(
    private readonly networkId: string,
    rpcUrl: string,
    accountId: string,
    privateKey: string,
    contractId: string
  ) {
    this.contractId = contractId;
    this.accountId = accountId;
    this.rpcUrl = rpcUrl;
    this.initConnection(privateKey).catch((err) => {
      logger.error({ err }, "Failed to initialize NEAR connection");
      throw err;
    });
  }

  private async initConnection(privateKey: string): Promise<void> {
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(privateKey as `ed25519:${string}`);
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
      methodName: "owner_nonce",
      args: { owner_b58: ownerB58 },
    });
    return Number(result);
  }

  async getVault(vaultId: number): Promise<VaultInfo | null> {
    const result = await this.account.viewFunction({
      contractId: this.contractId,
      methodName: "get_vault",
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
          "owner_action",
          { msg, sig },
          BigInt(gasAmount),
          BigInt(depositYocto)
        ),
      ];

      const accessKeyInfo = await this.account.findAccessKey(
        this.contractId,
        actions
      );
      if (!accessKeyInfo) {
        throw new Error("No matching access key for the relay account");
      }

      const block = await this.connection.connection.provider.block({
        finality: "final",
      });
      const nonce = BigInt(accessKeyInfo.accessKey.nonce) + 1n;

      // Sign locally so the hash exists before any broadcast. A later
      // near-api-js nonce retry is NOT used here; a single signed tx is sent.
      const [hashBytes, signedTx] = await transactions.signTransaction(
        this.contractId,
        nonce,
        actions,
        utils.serialize.base_decode(block.header.hash),
        this.account.connection.signer,
        this.accountId,
        this.networkId
      );
      const txHash = utils.serialize.base_encode(hashBytes);
      hooks?.onSigned?.(txHash);

      this.account.accessKeyByPublicKeyCache[accessKeyInfo.publicKey.toString()] =
        {
          ...accessKeyInfo.accessKey,
          nonce,
        };

      try {
        const outcome = await this.connection.connection.provider.sendTransaction(
          signedTx
        );
        return this.outcomeToResult(outcome, txHash, depositYocto);
      } catch (error: unknown) {
        logger.error({ error, txHash }, "NEAR transaction failed");
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

  private outcomeToResult(
    outcome: {
      transaction: { hash: string | Uint8Array };
      receipts_outcome?: Array<{ outcome?: { logs?: string[]; tokens_burnt?: string } }>;
      transaction_outcome?: { outcome?: { tokens_burnt?: string } };
      status: unknown;
    },
    fallbackHash: string,
    depositYocto: string
  ): NearTransaction {
    const txHash =
      typeof outcome.transaction.hash === "string"
        ? outcome.transaction.hash
        : utils.serialize.base_encode(outcome.transaction.hash) || fallbackHash;

    const logs: string[] = [];
    if (outcome.receipts_outcome) {
      for (const receipt of outcome.receipts_outcome) {
        logs.push(...(receipt.outcome?.logs ?? []));
      }
    }

    const status = asRecord(outcome.status) ?? {};
    const success = "SuccessValue" in status || "SuccessReceiptId" in status;

    let errorMessageText: string | undefined;
    if (!success && "Failure" in status) {
      errorMessageText = this.extractErrorMessage(status.Failure, logs);
    }

    const tokensBurntYocto = sumTokensBurnt(outcome);

    logger.info(
      { txHash, success, logs, depositYocto, tokensBurntYocto },
      "NEAR transaction complete"
    );

    return { txHash, success, errorMessage: errorMessageText, tokensBurntYocto };
  }

  private extractErrorMessage(failure: unknown, logs: string[]): string {
    const sgError = logs.find((log) => log.includes("SG_E"));
    if (sgError) return sgError;

    const failureRecord = asRecord(failure);
    if (!failureRecord || !("ActionError" in failureRecord)) {
      return JSON.stringify(failure);
    }

    const actionError = failureRecord.ActionError;
    const kind = asRecord(actionError)?.kind;
    const execution = asRecord(asRecord(kind)?.FunctionCallError)?.ExecutionError;
    if (execution !== undefined) return String(execution);
    if (asRecord(kind)) return JSON.stringify(kind);
    return JSON.stringify(actionError);
  }

  /**
   * Raw JSON-RPC `tx` with a 10s abort. Avoids near-api-js retries that can
   * hang >60s on UNKNOWN_TRANSACTION. That name is treated as still pending.
   */
  async getTransactionStatus(txHash: string): Promise<TxStatusResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TX_STATUS_TIMEOUT_MS);
    try {
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "relay-tx-status",
          method: "tx",
          params: {
            tx_hash: txHash,
            sender_account_id: this.accountId,
            wait_until: "NONE",
          },
        }),
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        error?: { cause?: { name?: string }; name?: string; message?: string };
        result?: {
          status?: unknown;
          transaction_outcome?: { outcome?: { tokens_burnt?: string } };
          receipts_outcome?: Array<{ outcome?: { tokens_burnt?: string } }>;
        };
      };

      if (json.error) {
        const name = `${json.error.cause?.name ?? ""} ${json.error.name ?? ""} ${json.error.message ?? ""}`;
        if (/UNKNOWN_TRANSACTION|UNKNOWN_TX|DoesNotExist/i.test(name)) {
          return { status: "pending" };
        }
        return { status: "pending" };
      }

      const status = json.result?.status;
      const burnt = json.result ? sumTokensBurnt(json.result) : undefined;
      if (status && typeof status === "object") {
        if ("SuccessValue" in status || "SuccessReceiptId" in status) {
          return { status: "success", tokensBurntYocto: burnt };
        }
        if ("Failure" in status) {
          return { status: "failure", tokensBurntYocto: burnt };
        }
      }
      return { status: "pending" };
    } catch {
      return { status: "pending" };
    } finally {
      clearTimeout(timer);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function sumTokensBurnt(outcome: {
  transaction_outcome?: { outcome?: { tokens_burnt?: string } };
  receipts_outcome?: Array<{ outcome?: { tokens_burnt?: string } }>;
}): string {
  let total = 0n;
  const txBurnt = outcome.transaction_outcome?.outcome?.tokens_burnt;
  if (txBurnt) total += BigInt(txBurnt);
  for (const receipt of outcome.receipts_outcome ?? []) {
    const burnt = receipt.outcome?.tokens_burnt;
    if (burnt) total += BigInt(burnt);
  }
  return total.toString();
}
