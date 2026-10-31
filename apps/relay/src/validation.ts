import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";

const policySchema = z.object({
  per_tx_limit: z.array(z.tuple([z.string(), z.string()])),
  daily_cap: z.array(z.tuple([z.string(), z.string()])),
  programs: z.array(z.string()),
  max_priority_fee_lamports: z.string(),
  max_memo_len: z.number(),
  expires_at_ns: z.string(),
  loosen_delay_ns: z.string(),
});

const ACTION_SCHEMAS = {
  CreateVault: z.object({
    type: z.literal("CreateVault"),
    owner: z.string(),
    vault_address: z.string(),
    policy: policySchema,
  }),
  AddAgent: z.object({
    type: z.literal("AddAgent"),
    vault_id: z.number(),
    name: z.string(),
    public_key: z.string(),
    gas_funding: z.string(),
  }),
  AddRecipient: z.object({
    type: z.literal("AddRecipient"),
    vault_id: z.number(),
    recipient: z.string(),
  }),
  RemoveRecipient: z.object({
    type: z.literal("RemoveRecipient"),
    vault_id: z.number(),
    recipient: z.string(),
  }),
  BackfillRecipients: z.object({
    type: z.literal("BackfillRecipients"),
    vault_id: z.number(),
    recipients: z.array(z.string()),
  }),
  SetPolicy: z.object({
    type: z.literal("SetPolicy"),
    vault_id: z.number(),
    policy: policySchema,
  }),
  Pause: z.object({
    type: z.literal("Pause"),
    vault_id: z.number(),
  }),
  Unpause: z.object({
    type: z.literal("Unpause"),
    vault_id: z.number(),
  }),
  RemoveAgent: z.object({
    type: z.literal("RemoveAgent"),
    vault_id: z.number(),
    agent: z.string(),
  }),
  RegisterTokenAccount: z.object({
    type: z.literal("RegisterTokenAccount"),
    vault_id: z.number(),
    ata: z.string(),
    mint: z.string(),
    decimals: z.number(),
  }),
  Release: z.object({
    type: z.literal("Release"),
    vault_id: z.number(),
    req_id: z.string(),
  }),
};

export type ActionType = keyof typeof ACTION_SCHEMAS;
export type AdminAction = z.infer<
  (typeof ACTION_SCHEMAS)[keyof typeof ACTION_SCHEMAS]
>;

export interface ParsedAdminMessage {
  network: string;
  contract: string;
  vault: number | null;
  nonce: number;
  expiry: bigint;
  action: AdminAction;
}

function requirePrefix(line: string | undefined, prefix: string): string {
  if (line === undefined || !line.startsWith(prefix)) {
    throw new Error(`Missing ${prefix.trim()}`);
  }
  return line.slice(prefix.length);
}

function parseExactUint(value: string, field: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${field}`);
  }
  return Number(value);
}

/** 1 <= nonce <= 2^53-1. Parsed as a decimal integer (u64-width string), not IEEE Number. */
const MIN_NONCE = 1n;
const MAX_SAFE_NONCE = BigInt(Number.MAX_SAFE_INTEGER);

function parseNonce(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid nonce");
  }
  const n = BigInt(value);
  if (n < MIN_NONCE || n > MAX_SAFE_NONCE) {
    throw new Error("Invalid nonce");
  }
  return Number(n);
}

const ED25519_PREFIX = "ed25519:";

/** Compare MPC `derived_public_key` (`ed25519:<b58>`) to a CreateVault vault_address. */
export function derivedKeyMatchesVaultAddress(
  derived: string,
  vaultAddressB58: string
): boolean {
  if (!derived.startsWith(ED25519_PREFIX)) {
    return false;
  }
  let derivedBytes: Uint8Array;
  let vaultBytes: Uint8Array;
  try {
    derivedBytes = bs58.decode(derived.slice(ED25519_PREFIX.length));
    vaultBytes = bs58.decode(vaultAddressB58);
  } catch {
    return false;
  }
  if (derivedBytes.length !== 32 || vaultBytes.length !== 32) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= derivedBytes[i]! ^ vaultBytes[i]!;
  }
  return diff === 0;
}

export function createVaultDerivationPath(
  ownerB58: string,
  ownerIndex: number
): string {
  return `vault/${ownerB58}/${ownerIndex}`;
}

function parseExactBigInt(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${field}`);
  }
  return BigInt(value);
}

export function parseAdminMessage(msg: string): ParsedAdminMessage {
  const lines = msg.split("\n");
  if (lines.length !== 7) {
    throw new Error("Invalid message format: expected 7 lines");
  }

  if (lines[0] !== "SANA-GUARD-ADMIN-v1") {
    throw new Error("Invalid message format: wrong header");
  }

  const network = requirePrefix(lines[1], "network: ");
  if (!network) throw new Error("Missing network field");

  const contract = requirePrefix(lines[2], "contract: ");
  if (!contract) throw new Error("Missing contract field");

  const vaultLine = requirePrefix(lines[3], "vault: ");
  if (!vaultLine) throw new Error("Missing vault field");
  const vault = vaultLine === "null" ? null : parseExactUint(vaultLine, "vault");

  const nonce = parseNonce(requirePrefix(lines[4], "nonce: "));
  const expiry = parseExactBigInt(requirePrefix(lines[5], "expires: "), "expires");
  const actionLine = requirePrefix(lines[6], "action: ");
  if (!actionLine) throw new Error("Missing action field");

  let actionData: unknown;
  try {
    actionData = JSON.parse(actionLine);
  } catch {
    throw new Error("Invalid action JSON");
  }

  if (
    !actionData ||
    typeof actionData !== "object" ||
    !("type" in actionData)
  ) {
    throw new Error("Action must have a type field");
  }

  const actionType = (actionData as { type: string }).type as ActionType;
  const schema = ACTION_SCHEMAS[actionType];
  if (!schema) {
    throw new Error(`Unknown action type: ${actionType}`);
  }

  const action = schema.parse(actionData);

  return { network, contract, vault, nonce, expiry, action };
}

export function verifySignature(
  msg: string,
  signature: Uint8Array,
  ownerB58: string
): boolean {
  if (signature.length !== 64) {
    return false;
  }

  let ownerPubkey: Uint8Array;
  try {
    ownerPubkey = bs58.decode(ownerB58);
  } catch {
    return false;
  }

  if (ownerPubkey.length !== 32) {
    return false;
  }

  const msgBytes = new TextEncoder().encode(msg);
  return nacl.sign.detached.verify(msgBytes, signature, ownerPubkey);
}

export function extractOwner(action: AdminAction): string {
  if (action.type === "CreateVault") {
    return action.owner;
  }
  throw new Error(
    "Cannot extract owner from action; must query vault from contract"
  );
}

export function getVaultId(action: AdminAction): number | null {
  if (action.type === "CreateVault") {
    return null;
  }
  return action.vault_id;
}
