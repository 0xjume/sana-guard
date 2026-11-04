'use client';

import {
  addAgentAction,
  addRecipientAction,
  createVaultAction,
  pauseAction,
  registerTokenAccountAction,
  removeAgentAction,
  removeRecipientAction,
  setPolicyAction,
  unpauseAction,
  type Policy,
} from '@sana-guard/sdk';
import { adminNetworkTag, publicConfig } from '@/lib/config';
import { createViews } from '@/lib/near';
import { pollOwnerTxUntilSettled } from '@/lib/owner-tx';
import { submitOwnerAction, type RelayAdminResult } from '@/lib/relay';
import {
  logOwnerActionTiming,
  reportOwnerSignProgress,
  waitForNextPaint,
} from '@/lib/sign-progress';
import type { Ed25519Signer } from '@sana-guard/sdk';

async function nextNonce(owner: string): Promise<number> {
  const current = await createViews(undefined, undefined, { finality: 'optimistic' }).getNonce(
    owner
  );
  return current + 1;
}

export async function runOwnerAction(args: {
  owner: string;
  signer: Ed25519Signer;
  build: (nonce: number) => Promise<{ message: string; signature: Uint8Array }>;
}): Promise<RelayAdminResult> {
  const started = Date.now();
  try {
    const nonceStarted = Date.now();
    const nonce = await nextNonce(args.owner);
    logOwnerActionTiming('nonce', nonceStarted);
    const signStarted = Date.now();
    const signed = await args.build(nonce);
    logOwnerActionTiming('sign', signStarted);
    const submitStarted = Date.now();
    const submitted = await submitOwnerAction({
      message: signed.message,
      signature: signed.signature,
      owner: args.owner,
    });
    logOwnerActionTiming('submit', submitStarted, {
      pending: Boolean(submitted.success && submitted.pending),
    });
    if (submitted.success && submitted.pending) {
      reportOwnerSignProgress({ phase: 'confirming', txHash: submitted.txHash });
      await waitForNextPaint();
      const pollStarted = Date.now();
      const settled = await pollOwnerTxUntilSettled({
        txHash: submitted.txHash,
        owner: args.owner,
      });
      logOwnerActionTiming('poll', pollStarted, { success: settled.success });
      return settled;
    }
    return submitted;
  } finally {
    logOwnerActionTiming('done', started);
    reportOwnerSignProgress(null);
  }
}

export function ownerActionHelpers(owner: string, signer: Ed25519Signer) {
  const network = adminNetworkTag(publicConfig.nearNetwork);
  const contract = publicConfig.guardContract;

  return {
    createVault(vaultAddress: string, policy: Policy) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) =>
          createVaultAction(network, contract, nonce, { owner, vaultAddress, policy }, signer),
      });
    },
    setPolicy(vaultId: number, policy: Policy) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) => setPolicyAction(network, contract, vaultId, nonce, policy, signer),
      });
    },
    pause(vaultId: number) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) => pauseAction(network, contract, vaultId, nonce, signer),
      });
    },
    unpause(vaultId: number) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) => unpauseAction(network, contract, vaultId, nonce, signer),
      });
    },
    addRecipient(vaultId: number, recipient: string) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) => addRecipientAction(network, contract, vaultId, nonce, recipient, signer),
      });
    },
    removeRecipient(vaultId: number, recipient: string) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) =>
          removeRecipientAction(network, contract, vaultId, nonce, recipient, signer),
      });
    },
    addAgent(vaultId: number, name: string, publicKey: string, gasFunding: bigint) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) =>
          addAgentAction(
            network,
            contract,
            nonce,
            { vaultId, name, publicKey, gasFunding },
            signer
          ),
      });
    },
    removeAgent(vaultId: number, agent: string) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) => removeAgentAction(network, contract, vaultId, nonce, agent, signer),
      });
    },
    registerTokenAccount(vaultId: number, ata: string, mint: string, decimals: number) {
      return runOwnerAction({
        owner,
        signer,
        build: (nonce) =>
          registerTokenAccountAction(
            network,
            contract,
            vaultId,
            nonce,
            ata,
            mint,
            decimals,
            signer
          ),
      });
    },
  };
}
