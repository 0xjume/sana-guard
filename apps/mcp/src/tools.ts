import { createHash, randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  buildSolTransfer,
  buildTokenTransfer,
  validateIdempotencyKey,
  extractRecentBlockhash,
  solanaExplorerUrl,
  type BroadcastResult,
  type SignRequestView,
} from "@sana-guard/sdk";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { parseAmountString } from "./amounts.js";
import { BLOCKHASH_EXPIRED_CODE, KEY_REUSED_CODE, toolError, toolOk, whyForCode } from "./errors.js";
import { checkTransfer } from "./policyCheck.js";
import { checkSignMessage } from "./outflow.js";
import { solanaSignatureBase58 } from "./signature.js";
import { decodeBase64Tx } from "./tx.js";
import type { GuardRuntime } from "./runtime.js";

export function generateIdempotencyKey(): string {
  return randomBytes(32).toString("hex");
}

export function resolveIdempotencyKey(key?: string): string {
  if (key === undefined || key === "") {
    return generateIdempotencyKey();
  }
  validateIdempotencyKey(key);
  return key;
}

function mintKeyFromPolicy(mint: { type: "sol" } | { type: "spl"; address: PublicKey }): string {
  return mint.type === "sol" ? "SOL" : mint.address.toBase58();
}

function explorerFor(runtime: GuardRuntime, signature: string): string {
  return solanaExplorerUrl(signature, runtime.publicConfig.solanaCluster, runtime.config.solanaRpcUrl);
}

function writeSuccess(
  runtime: GuardRuntime,
  idempotencyKey: string,
  broadcast: BroadcastResult,
  extra: Record<string, unknown> = {}
) {
  return toolOk({
    ok: true,
    requestId: idempotencyKey,
    idempotencyKey,
    signature: broadcast.signature,
    explorer: explorerFor(runtime, broadcast.signature),
    status: broadcast.status,
    err: broadcast.err,
    nearTxHash: broadcast.nearTxHash,
    ...extra,
  });
}

function writeFailure(error: unknown, idempotencyKey: string) {
  return toolError(error, { idempotencyKey, requestId: idempotencyKey });
}

function requestSignatureFields(runtime: GuardRuntime, signature?: string) {
  const solanaSig = solanaSignatureBase58(signature);
  if (!solanaSig) {
    return {};
  }
  return {
    signature: solanaSig,
    explorer: explorerFor(runtime, solanaSig),
  };
}

function existingRequestResult(runtime: GuardRuntime, requestId: string, request: SignRequestView) {
  return toolOk({
    ok: true,
    alreadyExists: true,
    code: "SG_E059_DUPLICATE_REQ_ID",
    why: "This idempotencyKey was already submitted. This call did not sign or broadcast anything. Call sana_guard_get_request and check the Solana signature before telling the user the transfer landed.",
    requestId,
    idempotencyKey: requestId,
    vaultId: request.vaultId,
    agent: request.agent,
    msgHash: request.msgHash,
    status: request.status,
    createdNs: request.createdNs.toString(),
    spend: request.spend.map((row) => ({ mint: row.mint, amount: row.amount.toString() })),
    ...requestSignatureFields(runtime, request.signature),
  });
}

export function createToolHandlers(runtime: GuardRuntime) {
  const vaultId = runtime.config.vaultId;

  async function loadPolicyContext() {
    const [vault, spend24h, recipients] = await Promise.all([
      runtime.views.getVault(vaultId),
      runtime.views.getSpend24h(vaultId),
      runtime.views.getRecipients(vaultId),
    ]);
    return { vault, spend24h, recipients };
  }

  /**
   * Answer a repeated idempotencyKey from get_request. `matches` decides whether the stored
   * request is the same transfer; if not, the key was reused and the caller gets an error
   * instead of a success for a transfer it did not make.
   */
  async function existingWrite(
    idempotencyKey: string,
    matches: (request: SignRequestView) => boolean
  ) {
    const request = await runtime.views.getRequest(idempotencyKey);
    if (!request) {
      return undefined;
    }
    if (!matches(request)) {
      return toolOk(
        {
          ok: false,
          code: KEY_REUSED_CODE,
          why: whyForCode(KEY_REUSED_CODE),
          requestId: idempotencyKey,
          idempotencyKey,
          existingSpend: request.spend.map((row) => ({
            mint: row.mint,
            amount: row.amount.toString(),
          })),
        },
        true
      );
    }
    return existingRequestResult(runtime, idempotencyKey, request);
  }

  async function precheckBuiltMessage(message: Uint8Array) {
    const { vault, spend24h, recipients } = await loadPolicyContext();
    return checkSignMessage({
      message,
      vaultAddress: runtime.vaultAddress,
      vault,
      spend24h,
      recipients,
      nowNs: runtime.nowNs(),
      maxLamportsPerCall: runtime.config.maxLamportsPerCall,
      maxTokenAmountPerCall: runtime.config.maxTokenAmountPerCall,
    });
  }

  /** Same single-mint spend as an SDK-built transfer (no compute budget instructions). */
  function spendIs(mint: string, amount: bigint) {
    return (request: SignRequestView) =>
      request.spend.length === 1 &&
      request.spend[0].mint === mint &&
      request.spend[0].amount === amount;
  }

  return {
    async status() {
      try {
        const { vault, spend24h } = await loadPolicyContext();
        if (!vault) {
          return toolError(new Error("SG_E054_VAULT_NOT_FOUND: Vault not found"));
        }
        const nowNs = runtime.nowNs();
        const solBalance = await runtime.solana.getBalance(runtime.vaultAddress);
        const tokenBalances: Array<{ mint: string; amount: string }> = [];
        for (const row of vault.policy.perTxLimit) {
          if (row.mint.type === "spl") {
            const amount = await runtime.solana.getTokenBalance(runtime.vaultAddress, row.mint.address);
            tokenBalances.push({ mint: row.mint.address.toBase58(), amount: amount.toString() });
          }
        }
        return toolOk({
          ok: true,
          agentAccount: runtime.publicConfig.agentAccountId,
          vaultId,
          vaultAddress: runtime.vaultAddress.toBase58(),
          owner: vault.owner,
          nearNetwork: runtime.publicConfig.nearNetwork,
          solanaCluster: runtime.publicConfig.solanaCluster,
          state: vault.state,
          paused: vault.paused,
          killSwitch: vault.paused,
          expiresAtNs: vault.policy.expiresAtNs.toString(),
          expired: nowNs >= vault.policy.expiresAtNs,
          balances: {
            solLamports: solBalance.toString(),
            tokens: tokenBalances,
          },
          spend24h: spend24h.map((row) => ({ mint: row.mint, amount: row.amount.toString() })),
        });
      } catch (error) {
        return toolError(error);
      }
    },

    async getPolicy() {
      try {
        const { vault, spend24h, recipients } = await loadPolicyContext();
        if (!vault) {
          return toolError(new Error("SG_E054_VAULT_NOT_FOUND: Vault not found"));
        }
        const remaining = vault.policy.dailyCap.map((row) => {
          const key = mintKeyFromPolicy(row.mint);
          const spent = spend24h
            .filter((s) => (s.mint === "Sol" || s.mint === "SOL" ? "SOL" : s.mint) === key)
            .reduce((sum, s) => sum + s.amount, 0n);
          const left = row.amount > spent ? row.amount - spent : 0n;
          return {
            mint: key,
            dailyCap: row.amount.toString(),
            spent24h: spent.toString(),
            remaining24h: left.toString(),
          };
        });
        return toolOk({
          ok: true,
          vaultId,
          paused: vault.paused,
          state: vault.state,
          expiresAtNs: vault.policy.expiresAtNs.toString(),
          maxMemoLen: vault.policy.maxMemoLen,
          maxPriorityFeeLamports: vault.policy.maxPriorityFeeLamports.toString(),
          maxTotalPriorityFeeLamports: vault.policy.maxTotalPriorityFeeLamports?.toString(),
          programs: vault.policy.programs,
          recipients,
          perTxLimit: vault.policy.perTxLimit.map((row) => ({
            mint: mintKeyFromPolicy(row.mint),
            amount: row.amount.toString(),
          })),
          dailyCap: vault.policy.dailyCap.map((row) => ({
            mint: mintKeyFromPolicy(row.mint),
            amount: row.amount.toString(),
          })),
          remaining,
          rolling24h: remaining,
        });
      } catch (error) {
        return toolError(error);
      }
    },

    async checkTransfer(args: { kind: "sol" | "spl"; to: string; amount: string; mint?: string }) {
      try {
        const { vault, spend24h, recipients } = await loadPolicyContext();
        const result = await checkTransfer({
          vault,
          spend24h,
          recipients,
          nowNs: runtime.nowNs(),
          maxLamportsPerCall: runtime.config.maxLamportsPerCall,
          maxTokenAmountPerCall: runtime.config.maxTokenAmountPerCall,
          input: {
            kind: args.kind,
            to: args.to,
            amount: parseAmountString(args.amount),
            mint: args.mint,
          },
        });
        return toolOk(result, !result.wouldPass);
      } catch (error) {
        return toolError(error);
      }
    },

    async transferSol(args: {
      to: string;
      amount: string;
      memo?: string;
      idempotencyKey?: string;
    }) {
      const idempotencyKey = resolveIdempotencyKey(args.idempotencyKey);
      try {
        const amount = parseAmountString(args.amount, "amount");
        const existing = await existingWrite(idempotencyKey, spendIs("SOL", amount));
        if (existing) {
          return existing;
        }
        const pre = await this.checkTransfer({ kind: "sol", to: args.to, amount: args.amount });
        if ("isError" in pre && pre.isError) {
          return pre;
        }
        const { blockhash, lastValidBlockHeight } = await runtime.solana.getLatestBlockhash();
        const message = buildSolTransfer(
          runtime.vaultAddress,
          new PublicKey(args.to),
          amount,
          blockhash,
          // Let the outflow path emit SG_E073 / SG_E074; do not fail in the SDK builder first.
          { version: "v0", memo: args.memo, maxMemoLen: 65535 }
        );
        const preSign = await precheckBuiltMessage(message);
        if (!preSign.wouldPass) {
          return toolOk(preSign, true);
        }
        const broadcast = await runtime.client.requestSignAndBroadcast({
          vaultId,
          message,
          lastValidBlockHeight,
          idempotencyKey,
          explorerCluster: runtime.publicConfig.solanaCluster,
        });
        return writeSuccess(runtime, idempotencyKey, broadcast);
      } catch (error) {
        return writeFailure(error, idempotencyKey);
      }
    },

    async transferSpl(args: {
      to: string;
      mint: string;
      amount: string;
      decimals?: number;
      memo?: string;
      idempotencyKey?: string;
    }) {
      const idempotencyKey = resolveIdempotencyKey(args.idempotencyKey);
      try {
        const amount = parseAmountString(args.amount, "amount");
        const mint = new PublicKey(args.mint);
        const existing = await existingWrite(idempotencyKey, spendIs(mint.toBase58(), amount));
        if (existing) {
          return existing;
        }
        const decimals = args.decimals ?? (await runtime.solana.getMintDecimals(mint));
        const pre = await this.checkTransfer({
          kind: "spl",
          to: args.to,
          amount: args.amount,
          mint: args.mint,
        });
        if ("isError" in pre && pre.isError) {
          return pre;
        }
        const { blockhash, lastValidBlockHeight } = await runtime.solana.getLatestBlockhash();
        const fromTokenAccount = await getAssociatedTokenAddress(mint, runtime.vaultAddress);
        const toTokenAccount = await getAssociatedTokenAddress(mint, new PublicKey(args.to));
        const message = buildTokenTransfer(
          runtime.vaultAddress,
          new PublicKey(args.to),
          mint,
          amount,
          decimals,
          fromTokenAccount,
          toTokenAccount,
          blockhash,
          { version: "v0", createAta: false, memo: args.memo, maxMemoLen: 65535 }
        );
        const preSign = await precheckBuiltMessage(message);
        if (!preSign.wouldPass) {
          return toolOk(preSign, true);
        }
        const broadcast = await runtime.client.requestSignAndBroadcast({
          vaultId,
          message,
          lastValidBlockHeight,
          idempotencyKey,
          explorerCluster: runtime.publicConfig.solanaCluster,
        });
        return writeSuccess(runtime, idempotencyKey, broadcast, {
          mint: args.mint,
          destinationAta: toTokenAccount.toBase58(),
        });
      } catch (error) {
        return writeFailure(error, idempotencyKey);
      }
    },

    async signTransaction(args: { transactionBase64: string; idempotencyKey?: string }) {
      const idempotencyKey = resolveIdempotencyKey(args.idempotencyKey);
      try {
        const message = decodeBase64Tx(args.transactionBase64);
        // The contract's get_request reports msg_hash as base58(sha256(message)).
        const msgHash = bs58.encode(createHash("sha256").update(message).digest());
        const existing = await existingWrite(
          idempotencyKey,
          (request) => request.msgHash === msgHash
        );
        if (existing) {
          return existing;
        }
        const recentBlockhash = extractRecentBlockhash(message);
        // Signing reserves spend and burns the request id, so refuse a message that can no
        // longer land instead of signing it and failing at broadcast.
        if (!(await runtime.solana.isBlockhashValid(recentBlockhash))) {
          return toolOk(
            {
              ok: false,
              code: BLOCKHASH_EXPIRED_CODE,
              why: whyForCode(BLOCKHASH_EXPIRED_CODE),
              requestId: idempotencyKey,
              idempotencyKey,
            },
            true
          );
        }
        const pre = await precheckBuiltMessage(message);
        if (!pre.wouldPass) {
          return toolOk(pre, true);
        }
        // Upper bound for the message's own blockhash, which was just checked to be valid.
        const { lastValidBlockHeight } = await runtime.solana.getLatestBlockhash();
        const broadcast = await runtime.client.requestSignAndBroadcast({
          vaultId,
          message,
          lastValidBlockHeight,
          idempotencyKey,
          explorerCluster: runtime.publicConfig.solanaCluster,
        });
        return writeSuccess(runtime, idempotencyKey, broadcast, {
          spend: pre.spend,
        });
      } catch (error) {
        return writeFailure(error, idempotencyKey);
      }
    },

    async getRequest(args: { requestId: string }) {
      try {
        validateIdempotencyKey(args.requestId);
        const request = await runtime.views.getRequest(args.requestId);
        if (!request) {
          return toolOk({ ok: true, found: false, requestId: args.requestId });
        }
        return toolOk({
          ok: true,
          found: true,
          requestId: args.requestId,
          vaultId: request.vaultId,
          agent: request.agent,
          msgHash: request.msgHash,
          status: request.status,
          createdNs: request.createdNs.toString(),
          spend: request.spend.map((row) => ({ mint: row.mint, amount: row.amount.toString() })),
          ...requestSignatureFields(runtime, request.signature),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
