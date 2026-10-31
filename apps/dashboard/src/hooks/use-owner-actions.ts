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
import { submitOwnerAction, type RelayAdminResult } from '@/lib/relay';
import type { Ed25519Signer } from '@sana-guard/sdk';

async function nextNonce(owner: string): Promise<number> {
  const current = await createViews().getNonce(owner);
  return current + 1;
}

export async function runOwnerAction(args: {
  owner: string;
  signer: Ed25519Signer;
  inviteToken?: string;
  build: (nonce: number) => Promise<{ message: string; signature: Uint8Array }>;
}): Promise<RelayAdminResult> {
  const nonce = await nextNonce(args.owner);
  const signed = await args.build(nonce);
  return submitOwnerAction({
    message: signed.message,
    signature: signed.signature,
    owner: args.owner,
    inviteToken: args.inviteToken,
  });
}

export function ownerActionHelpers(owner: string, signer: Ed25519Signer, inviteToken?: string) {
  const network = adminNetworkTag(publicConfig.nearNetwork);
  const contract = publicConfig.guardContract;

  return {
    createVault(vaultAddress: string, policy: Policy) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
        build: (nonce) =>
          createVaultAction(network, contract, nonce, { owner, vaultAddress, policy }, signer),
      });
    },
    setPolicy(vaultId: number, policy: Policy) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
        build: (nonce) => setPolicyAction(network, contract, vaultId, nonce, policy, signer),
      });
    },
    pause(vaultId: number) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
        build: (nonce) => pauseAction(network, contract, vaultId, nonce, signer),
      });
    },
    unpause(vaultId: number) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
        build: (nonce) => unpauseAction(network, contract, vaultId, nonce, signer),
      });
    },
    addRecipient(vaultId: number, recipient: string) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
        build: (nonce) => addRecipientAction(network, contract, vaultId, nonce, recipient, signer),
      });
    },
    removeRecipient(vaultId: number, recipient: string) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
        build: (nonce) =>
          removeRecipientAction(network, contract, vaultId, nonce, recipient, signer),
      });
    },
    addAgent(vaultId: number, name: string, publicKey: string, gasFunding: bigint) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
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
        inviteToken,
        build: (nonce) => removeAgentAction(network, contract, vaultId, nonce, agent, signer),
      });
    },
    registerTokenAccount(vaultId: number, ata: string, mint: string, decimals: number) {
      return runOwnerAction({
        owner,
        signer,
        inviteToken,
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
