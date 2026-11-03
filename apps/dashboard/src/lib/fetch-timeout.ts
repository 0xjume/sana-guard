/** Read requests give up after this long so a hung RPC shows an error instead of a skeleton. */
export const READ_TIMEOUT_MS = 10_000;

export class RequestTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not respond within ${Math.round(ms / 1000)}s`);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * `fetch` with a deadline. Only for reads: a write that times out on the client may still land.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit & { next?: { revalidate?: number } } = {},
  label = 'The server',
  ms = READ_TIMEOUT_MS
): Promise<Response> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new RequestTimeoutError(label, ms);
    }
    throw error;
  }
}
