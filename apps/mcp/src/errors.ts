import {
  SanaGuardError,
  SanaGuardSignError,
  createSanaGuardError,
  getErrorMessage,
  parseErrorCode,
} from "@sana-guard/sdk";
import { stringifyJson } from "./amounts.js";

export interface StructuredError {
  ok: false;
  code: string;
  message: string;
  why: string;
  requestId?: string;
}

export const SERVER_MAX_CODE = "SANA_GUARD_MAX_PER_CALL";
export const MAINNET_REFUSED_CODE = "SANA_GUARD_MAINNET_REFUSED";

const WHY: Record<string, string> = {
  SG_E055_VAULT_PAUSED:
    "The vault kill switch is on. The owner must unpause before any spend.",
  SG_E057_POLICY_EXPIRED:
    "The vault policy has expired. The owner must sign a new SetPolicy.",
  SG_E062_PER_TX_LIMIT_EXCEEDED:
    "This amount is above the per-transaction limit for this mint. Do not retry with the same amount.",
  SG_E063_MINT_NOT_IN_PER_TX_LIMIT:
    "This mint is not in the vault per-transaction limits.",
  SG_E064_DAILY_CAP_EXCEEDED:
    "This transfer would exceed the rolling 24-hour cap. Wait for spend to age out or ask the owner to raise the cap.",
  SG_E065_MINT_NOT_IN_DAILY_CAP: "This mint is not in the vault 24-hour cap.",
  SG_E067_RECIPIENT_NOT_ALLOWED:
    "The SOL recipient wallet is not on the vault allowlist.",
  SG_E068_RECIPIENT_NOT_ALLOWED:
    "The SPL destination ATA is not on the vault allowlist. Allowlist the ATA, not just the wallet.",
  SG_E069_MINT_NOT_IN_POLICY: "This SPL mint is not in the vault policy.",
  SG_E074_PROGRAM_NOT_ALLOWED:
    "A program in this transaction is not on the vault program allowlist.",
  SG_E076_VAULT_NOT_ACTIVE: "The vault is not Active (still pending verification).",
  SG_E077_AGENT_EXISTS: "That agent account name is already registered.",
  [SERVER_MAX_CODE]:
    "The server refused this amount because it exceeds SANA_GUARD_MAX_*_PER_CALL. This is not a contract error.",
  [MAINNET_REFUSED_CODE]:
    "Mainnet is disabled unless SANA_GUARD_ALLOW_MAINNET=true.",
};

export function whyForCode(code: string): string {
  return WHY[code] ?? getErrorMessage(code);
}

export function structuredFromUnknown(error: unknown): StructuredError {
  if (error instanceof SanaGuardSignError) {
    const code = error.code ?? "SANA_GUARD_SIGN_FAILED";
    return {
      ok: false,
      code,
      message: error.message,
      why: whyForCode(code),
      requestId: error.requestId,
    };
  }
  if (error instanceof SanaGuardError) {
    const code = error.code ?? "SANA_GUARD_ERROR";
    return {
      ok: false,
      code,
      message: error.message,
      why: whyForCode(code),
    };
  }
  const raw = error instanceof Error ? error.message : String(error);
  const mapped = createSanaGuardError(raw);
  const code = mapped.code ?? parseErrorCode(raw) ?? "SANA_GUARD_ERROR";
  return {
    ok: false,
    code,
    message: mapped.message,
    why: whyForCode(code),
  };
}

export function toolError(error: unknown) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: stringifyJson(structuredFromUnknown(error)) }],
  };
}

export function toolOk(value: unknown, isError = false) {
  return {
    ...(isError ? { isError: true as const } : {}),
    content: [{ type: "text" as const, text: stringifyJson(value) }],
  };
}
