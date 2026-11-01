import { getErrorMessage, parseErrorCode } from '@sana-guard/sdk';

export interface GuardActionError {
  message: string;
  code?: string;
  txHash?: string;
  httpStatus?: number;
}

export function explainGuardError(input: unknown): GuardActionError {
  if (typeof input === 'string') {
    const code = parseErrorCode(input);
    return {
      code: code ?? undefined,
      message: code ? getErrorMessage(code) : input,
    };
  }

  if (input instanceof Error) {
    const code = parseErrorCode(input.message);
    return {
      code: code ?? undefined,
      message: code ? getErrorMessage(code) : input.message,
    };
  }

  if (input && typeof input === 'object') {
    const record = input as {
      error?: unknown;
      message?: unknown;
      code?: unknown;
      txHash?: unknown;
    };
    const raw =
      typeof record.error === 'string'
        ? record.error
        : typeof record.message === 'string'
          ? record.message
          : JSON.stringify(input);
    const code =
      (typeof record.code === 'string' && record.code) || parseErrorCode(raw) || undefined;
    return {
      code,
      message: code && code.startsWith('SG_E') ? getErrorMessage(code) : raw,
      txHash: typeof record.txHash === 'string' ? record.txHash : undefined,
    };
  }

  return { message: 'Unknown error' };
}

export function formatActionError(error: GuardActionError): string {
  if (error.code && error.message && !error.message.includes(error.code)) {
    return `${error.code}: ${error.message}`;
  }
  return error.code ? `${error.code}: ${error.message}` : error.message;
}
