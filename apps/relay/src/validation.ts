import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";

const ACTION_SCHEMAS = {
  CreateVault: z.object({
    type: z.literal("CreateVault"),
    owner: z.string(),
    vault_address: z.string(),
    policy: z.object({
      per_tx_limit: z.array(z.tuple([z.string(), z.string()])),
      daily_cap: z.array(z.tuple([z.string(), z.string()])),
      programs: z.array(z.string()),
      max_priority_fee_lamports: z.string(),
      max_memo_len: z.number(),
      expires_at_ns: z.string(),
      loosen_delay_ns: z.string(),
    }),
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
  SetPolicy: z.object({
    type: z.literal("SetPolicy"),
    vault_id: z.number(),
    policy: z.object({
      per_tx_limit: z.array(z.tuple([z.string(), z.string()])),
      daily_cap: z.array(z.tuple([z.string(), z.string()])),
      programs: z.array(z.string()),
      max_priority_fee_lamports: z.string(),
      max_memo_len: z.number(),
      expires_at_ns: z.string(),
      loosen_delay_ns: z.string(),
    }),
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

export function parseAdminMessage(msg: string): ParsedAdminMessage {
  const lines = msg.split("\n");
  if (lines.length !== 7) {
    throw new Error("Invalid message format: expected 7 lines");
  }

  if (lines[0] !== "SANA-GUARD-ADMIN-v1") {
    throw new Error("Invalid message format: wrong header");
  }

  const network = lines[1]?.replace("network: ", "");
  if (!network) throw new Error("Missing network field");

  const contract = lines[2]?.replace("contract: ", "");
  if (!contract) throw new Error("Missing contract field");

  const vaultLine = lines[3]?.replace("vault: ", "");
  if (!vaultLine) throw new Error("Missing vault field");
  const vault = vaultLine === "null" ? null : parseInt(vaultLine, 10);
  if (vault !== null && isNaN(vault)) {
    throw new Error("Invalid vault field");
  }

  const nonceLine = lines[4]?.replace("nonce: ", "");
  if (!nonceLine) throw new Error("Missing nonce field");
  const nonce = parseInt(nonceLine, 10);
  if (isNaN(nonce)) throw new Error("Invalid nonce field");

  const expiryLine = lines[5]?.replace("expires: ", "");
  if (!expiryLine) throw new Error("Missing expires field");
  const expiry = BigInt(expiryLine);

  const actionLine = lines[6]?.replace("action: ", "");
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
