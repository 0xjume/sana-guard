import { SanaGuardError, createSanaGuardError, parseErrorCode } from '@sana-guard/sdk';

/**
 * Map a request_sign failure onto the attempt the result card classifies.
 *
 * The SDK already sets `.code` and replaces the panic with the human message
 * ("Per-transaction limit exceeded for mint"), which has no SG_E### substring.
 * Parsing only that message drops the code, and the result card labels the
 * policy block as a transport failure.
 */
export function attackLabErrorPayload(error: unknown): { message: string; code?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const carriedCode = error instanceof SanaGuardError && error.code ? error.code : undefined;
  if (carriedCode) {
    return { message, code: carriedCode };
  }
  const mapped = createSanaGuardError(message);
  const code = mapped.code ?? parseErrorCode(mapped.message) ?? undefined;
  return { message: mapped.message, code };
}
