import * as nearAPI from "near-api-js";
import { logger } from "../logger.js";
import { Mutex } from "../mutex.js";
import type { NearClient, NearTransaction, VaultInfo } from "./interface.js";

const { connect, keyStores, KeyPair } = nearAPI;

export class NearClientImpl implements NearClient {
  private connection!: nearAPI.Near;
  private account!: nearAPI.Account;
  private readonly contractId: string;
  private readonly accountId: string;
  private readonly submitMutex = new Mutex();

  constructor(
    private readonly networkId: string,
    private readonly rpcUrl: string,
    accountId: string,
    privateKey: string,
    contractId: string
  ) {
    this.contractId = contractId;
    this.accountId = accountId;
    this.initConnection(privateKey).catch((err) => {
      logger.error({ err }, "Failed to initialize NEAR connection");
      throw err;
    });
  }

  private async initConnection(privateKey: string): Promise<void> {
    const keyStore = new keyStores.InMemoryKeyStore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyPair = KeyPair.fromString(privateKey as any);
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
    gasAmount: string
  ): Promise<NearTransaction> {
    return this.submitMutex.run(async () => {
      try {
        // near-api-js retries on a stale access-key nonce by signing and
        // broadcasting again. That can produce more than one on-chain tx
        // for a single submitOwnerAction call.
        const outcome = await this.account.functionCall({
          contractId: this.contractId,
          methodName: "owner_action",
          args: { msg, sig },
          gas: BigInt(gasAmount),
          attachedDeposit: BigInt(depositYocto),
        });

        const txHash =
          typeof outcome.transaction.hash === "string"
            ? outcome.transaction.hash
            : nearAPI.utils.serialize.base_encode(outcome.transaction.hash);

        const logs: string[] = [];
        if (outcome.receipts_outcome) {
          for (const receipt of outcome.receipts_outcome) {
            logs.push(...receipt.outcome.logs);
          }
        }

        const status = outcome.status as Record<string, unknown>;
        const success = "SuccessValue" in status || "SuccessReceiptId" in status;

        let errorMessage: string | undefined;
        if (!success && "Failure" in status) {
          errorMessage = this.extractErrorMessage(status.Failure, logs);
        }

        const tokensBurntYocto = sumTokensBurnt(outcome);

        logger.info(
          { txHash, success, logs, depositYocto, tokensBurntYocto },
          "NEAR transaction complete"
        );

        return { txHash, success, errorMessage, tokensBurntYocto };
      } catch (error: unknown) {
        logger.error({ error }, "NEAR transaction failed");
        if (
          error &&
          typeof error === "object" &&
          "transaction" in error &&
          error.transaction &&
          typeof error.transaction === "object" &&
          "hash" in error.transaction
        ) {
          const hash = (error.transaction as { hash: unknown }).hash;
          const txHash =
            typeof hash === "string"
              ? hash
              : nearAPI.utils.serialize.base_encode(hash as Uint8Array);
          return {
            txHash,
            success: false,
            errorMessage: this.extractErrorFromException(error),
          };
        }
        throw error;
      }
    });
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

  private extractErrorFromException(error: unknown): string {
    if (error && typeof error === "object") {
      if ("message" in error && typeof error.message === "string") {
        return error.message;
      }
      return JSON.stringify(error);
    }
    return String(error);
  }

  async getTransactionStatus(
    txHash: string
  ): Promise<"success" | "failure" | "pending"> {
    try {
      const result = await this.connection.connection.provider.txStatus(
        txHash,
        this.accountId,
        "FINAL"
      );
      const status = result.status as unknown;
      if (status && typeof status === "object") {
        if ("SuccessValue" in status || "SuccessReceiptId" in status) {
          return "success";
        }
        if ("Failure" in status) {
          return "failure";
        }
      }
      return "pending";
    } catch {
      return "pending";
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

