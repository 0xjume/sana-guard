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

        logger.info(
          { txHash, success, logs, depositYocto },
          "NEAR transaction complete"
        );

        return { txHash, success, errorMessage };
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
    if (sgError) {
      return sgError;
    }

    if (failure && typeof failure === "object" && "ActionError" in failure) {
      const actionError = (failure as { ActionError: unknown }).ActionError;
      if (
        actionError &&
        typeof actionError === "object" &&
        "kind" in actionError
      ) {
        const kind = (actionError as { kind: unknown }).kind;
        if (
          kind &&
          typeof kind === "object" &&
          "FunctionCallError" in kind
        ) {
          const fcError = (kind as { FunctionCallError: unknown })
            .FunctionCallError;
          if (
            fcError &&
            typeof fcError === "object" &&
            "ExecutionError" in fcError
          ) {
            return String((fcError as { ExecutionError: unknown }).ExecutionError);
          }
        }
        return JSON.stringify(kind);
      }
      return JSON.stringify(actionError);
    }

    return JSON.stringify(failure);
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
}

