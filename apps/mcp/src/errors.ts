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
  idempotencyKey?: string;
  nearTxHash?: string;
}

export const SERVER_MAX_CODE = "SANA_GUARD_MAX_PER_CALL";
export const MAINNET_REFUSED_CODE = "SANA_GUARD_MAINNET_REFUSED";
export const UNACCOUNTABLE_CODE = "SANA_GUARD_UNACCOUNTABLE_TX";

export interface ErrorContext {
  idempotencyKey?: string;
  requestId?: string;
  nearTxHash?: string;
}

const WHY: Record<string, string> = {
  SG_E055_VAULT_PAUSED:
    "The vault kill switch is on. The owner must unpause before any spend.",
  SG_E057_POLICY_EXPIRED:
    "The vault policy has expired. The owner must sign a new SetPolicy.",
  SG_E059_DUPLICATE_REQ_ID:
    "This idempotencyKey was already submitted. Call sana_guard_get_request with that requestId instead of retrying. A retry costs gas and will not create a new spend.",
  SG_E061_WRONG_FEE_PAYER: "The Solana fee payer must be the vault address.",
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
  SG_E018_UNKNOWN_PROGRAM:
    "A program in this transaction is not supported. The server cannot account for its fund movement.",
  SG_E043_MINT_UNKNOWN:
    "Plain SPL transfer is unaccountable; use transferChecked so the mint is in the message.",
  [SERVER_MAX_CODE]:
    "The server refused this amount because it exceeds SANA_GUARD_MAX_*_PER_CALL. This is not a contract error.",
  [MAINNET_REFUSED_CODE]:
    "Mainnet is disabled unless SANA_GUARD_ALLOW_MAINNET=true.",
  [UNACCOUNTABLE_CODE]:
    "The server cannot fully account for every instruction that may move funds. Only allowlisted programs with known transfer/transferChecked/system transfer encodings are signed.",
  SANA_GUARD_ERROR: "An unexpected Sana Guard error occurred.",
};

export function whyForCode(code: string, fallbackMessage?: string): string {
  if (WHY[code]) {
    return WHY[code];
  }
  if (code.startsWith("SG_E")) {
    const mapped = getErrorMessage(code);
    if (!mapped.startsWith("Unknown error:")) {
      return mapped;
    }
  }
  return fallbackMessage ?? "An unexpected Sana Guard error occurred.";
}

export function structuredFromUnknown(error: unknown, extra: ErrorContext = {}): StructuredError {
  if (error instanceof SanaGuardSignError) {
    const code = error.code ?? "SANA_GUARD_SIGN_FAILED";
    return withContext(
      {
        ok: false,
        code,
        message: error.message,
        why: whyForCode(code, error.message),
        requestId: error.requestId,
        nearTxHash: error.nearTxHash,
      },
      extra
    );
  }
  if (error instanceof SanaGuardError) {
    const code = error.code ?? "SANA_GUARD_ERROR";
    return withContext(
      {
        ok: false,
        code,
        message: error.message,
        why: error.code ? whyForCode(code, error.message) : error.message,
      },
      extra
    );
  }
  const raw = error instanceof Error ? error.message : String(error);
  const mapped = createSanaGuardError(raw);
  const parsed = mapped.code ?? parseErrorCode(raw);
  const code = parsed ?? "SANA_GUARD_ERROR";
  return withContext(
    {
      ok: false,
      code,
      message: mapped.message,
      why: whyForCode(code, mapped.message),
    },
    extra
  );
}

function withContext(error: StructuredError, extra: ErrorContext): StructuredError {
  const requestId = extra.requestId ?? error.requestId;
  const idempotencyKey = extra.idempotencyKey ?? requestId;
  const nearTxHash = extra.nearTxHash ?? error.nearTxHash;
  return {
    ...error,
    ...(requestId ? { requestId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(nearTxHash ? { nearTxHash } : {}),
  };
}

export function toolError(error: unknown, extra: ErrorContext = {}) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: stringifyJson(structuredFromUnknown(error, extra)) }],
  };
}

export function toolOk(value: unknown, isError = false) {
  return {
    ...(isError ? { isError: true as const } : {}),
    content: [{ type: "text" as const, text: stringifyJson(value) }],
  };
}
