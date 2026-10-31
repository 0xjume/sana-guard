import { PublicKey } from '@solana/web3.js';
import { OwnerAction, Ed25519Signer, SignedAdminMessage, Policy } from './types';
import { SanaGuardError } from './errors';

/**
 * Admin message domain tag
 */
const ADMIN_DOMAIN_TAG = 'SANA-GUARD-ADMIN-v1';

/**
 * Required deposit amounts in yoctoNEAR
 */
export const VAULT_STORAGE_COST = BigInt('500000000000000000000000'); // 0.5 NEAR
export const AGENT_STORAGE_OVERHEAD = BigInt('50000000000000000000000'); // 0.05 NEAR
export const MIN_AGENT_FUNDING = BigInt('150000000000000000000000'); // 0.15 NEAR
export const MAX_AGENT_FUNDING = BigInt('500000000000000000000000'); // 0.5 NEAR

/**
 * Format a Policy for JSON encoding in admin messages
 */
function formatPolicyForJson(policy: Policy): object {
  return {
    per_tx_limit: policy.perTxLimit.map((p) => [
      p.mint.type === 'sol' ? 'Sol' : { Spl: Array.from(p.mint.address.toBytes()) },
      p.amount.toString(),
    ]),
    daily_cap: policy.dailyCap.map((p) => [
      p.mint.type === 'sol' ? 'Sol' : { Spl: Array.from(p.mint.address.toBytes()) },
      p.amount.toString(),
    ]),
    programs: policy.programs,
    max_priority_fee_lamports: policy.maxPriorityFeeLamports.toString(),
    max_total_priority_fee_lamports: policy.maxTotalPriorityFeeLamports?.toString(),
    max_memo_len: policy.maxMemoLen,
    expires_at_ns: policy.expiresAtNs.toString(),
    loosen_delay_ns: policy.loosenDelayNs.toString(),
  };
}

/**
 * Build an admin message string
 */
function buildAdminMessage(
  network: string,
  contract: string,
  vault: number | null,
  nonce: number,
  expiryNs: bigint,
  action: OwnerAction
): string {
  const vaultLine = vault === null ? 'null' : vault.toString();

  // Format action as compact JSON (no whitespace)
  let actionJson: string;

  switch (action.type) {
    case 'CreateVault':
      actionJson = JSON.stringify({
        type: action.type,
        owner: action.owner,
        vault_address: action.vaultAddress,
        policy: formatPolicyForJson(action.policy),
      });
      break;

    case 'AddAgent':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        name: action.name,
        public_key: action.publicKey,
        gas_funding: action.gasFunding.toString(),
      });
      break;

    case 'RemoveAgent':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        agent: action.agent,
      });
      break;

    case 'SetPolicy':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        policy: formatPolicyForJson(action.policy),
      });
      break;

    case 'AddRecipient':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        recipient: action.recipient,
      });
      break;

    case 'RemoveRecipient':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        recipient: action.recipient,
      });
      break;

    case 'RegisterTokenAccount':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        ata: action.ata,
        mint: action.mint,
        decimals: action.decimals,
      });
      break;

    case 'Pause':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
      });
      break;

    case 'Unpause':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
      });
      break;

    case 'Release':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        req_id: action.reqId,
      });
      break;

    case 'BackfillRecipients':
      actionJson = JSON.stringify({
        type: action.type,
        vault_id: action.vaultId,
        recipients: action.recipients,
      });
      break;
  }

  return [
    ADMIN_DOMAIN_TAG,
    `network: ${network}`,
    `contract: ${contract}`,
    `vault: ${vaultLine}`,
    `nonce: ${nonce}`,
    `expires: ${expiryNs}`,
    `action: ${actionJson}`,
  ].join('\n');
}

/**
 * Vault header for SANA-GUARD-ADMIN-v1: null for CreateVault, otherwise action.vaultId.
 */
export function vaultHeaderFromAction(action: OwnerAction): number | null {
  return action.type === 'CreateVault' ? null : action.vaultId;
}

/**
 * Sign an admin message with an Ed25519 signer.
 * The vault header is derived from the action (null for CreateVault).
 */
export async function signAdminMessage(
  network: string,
  contract: string,
  nonce: number,
  expiryNs: bigint,
  action: OwnerAction,
  signer: Ed25519Signer
): Promise<SignedAdminMessage> {
  const vault = vaultHeaderFromAction(action);
  const message = buildAdminMessage(network, contract, vault, nonce, expiryNs, action);
  const messageBytes = new TextEncoder().encode(message);
  const signature = await signer.sign(messageBytes);

  if (signature.length !== 64) {
    throw new SanaGuardError('Invalid signature length (expected 64 bytes)');
  }

  return {
    message,
    signature,
  };
}

/**
 * Calculate the required deposit for an owner action
 */
export function calculateRequiredDeposit(action: OwnerAction): bigint {
  switch (action.type) {
    case 'CreateVault':
      return VAULT_STORAGE_COST;
    case 'AddAgent':
      return action.gasFunding + AGENT_STORAGE_OVERHEAD;
    default:
      return BigInt(0);
  }
}

/**
 * Helper: CreateVault payload
 */
export interface CreateVaultParams {
  owner: string;
  vaultAddress: string;
  policy: Policy;
}

export async function createVaultAction(
  network: string,
  contract: string,
  nonce: number,
  params: CreateVaultParams,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'CreateVault',
    owner: params.owner,
    vaultAddress: params.vaultAddress,
    policy: params.policy,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: SetPolicy payload
 */
export async function setPolicyAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  policy: Policy,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'SetPolicy',
    vaultId,
    policy,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: AddRecipient payload
 */
export async function addRecipientAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  recipient: string,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'AddRecipient',
    vaultId,
    recipient,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: AddAgent payload
 */
export interface AddAgentParams {
  vaultId: number;
  name: string;
  publicKey: string;
  gasFunding: bigint;
}

export async function addAgentAction(
  network: string,
  contract: string,
  nonce: number,
  params: AddAgentParams,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  if (params.gasFunding < MIN_AGENT_FUNDING) {
    throw new SanaGuardError(`gas_funding below minimum (${MIN_AGENT_FUNDING})`);
  }

  if (params.gasFunding > MAX_AGENT_FUNDING) {
    throw new SanaGuardError(`gas_funding above maximum (${MAX_AGENT_FUNDING})`);
  }

  const action: OwnerAction = {
    type: 'AddAgent',
    ...params,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: Pause payload
 */
export async function pauseAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'Pause',
    vaultId,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: Unpause payload
 */
export async function unpauseAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'Unpause',
    vaultId,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: Release payload
 */
export async function releaseAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  reqId: string,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'Release',
    vaultId,
    reqId,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: BackfillRecipients payload
 */
export async function backfillRecipientsAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  recipients: string[],
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'BackfillRecipients',
    vaultId,
    recipients,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: RemoveAgent payload
 */
export async function removeAgentAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  agent: string,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'RemoveAgent',
    vaultId,
    agent,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: RemoveRecipient payload
 */
export async function removeRecipientAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  recipient: string,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'RemoveRecipient',
    vaultId,
    recipient,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Helper: RegisterTokenAccount payload
 */
export async function registerTokenAccountAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  ata: string,
  mint: string,
  decimals: number,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const expiryNs =
    BigInt(Date.now()) * BigInt(1_000_000) + BigInt(ttlSeconds) * BigInt(1_000_000_000);

  const action: OwnerAction = {
    type: 'RegisterTokenAccount',
    vaultId,
    ata,
    mint,
    decimals,
  };

  return signAdminMessage(network, contract, nonce, expiryNs, action, signer);
}

/**
 * Allowlist a recipient's Associated Token Account for an SPL mint.
 *
 * `transfer()` checks the destination ATA against the recipient allowlist
 * (`SG_E068`). Allowlisting the wallet is not enough — pass the ATA.
 * The ATA must already exist; the SDK does not create it (`createAta: false`).
 */
export async function addTokenAccountRecipientAction(
  network: string,
  contract: string,
  vaultId: number,
  nonce: number,
  recipient: PublicKey | string,
  mint: PublicKey | string,
  signer: Ed25519Signer,
  ttlSeconds: number = 600
): Promise<SignedAdminMessage> {
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  const recipientPk = typeof recipient === 'string' ? new PublicKey(recipient) : recipient;
  const mintPk = typeof mint === 'string' ? new PublicKey(mint) : mint;
  const ata = await getAssociatedTokenAddress(mintPk, recipientPk);
  return addRecipientAction(network, contract, vaultId, nonce, ata.toBase58(), signer, ttlSeconds);
}
