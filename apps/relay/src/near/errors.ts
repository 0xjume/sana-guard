export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export function errorType(error: unknown): string {
  if (error && typeof error === "object" && "type" in error) {
    return String(error.type);
  }
  return "";
}

/** Node rejected the tx before accepting it into the mempool. Safe to release. */
export function isPreAcceptanceRejection(error: unknown): boolean {
  const type = errorType(error);
  const msg = errorMessage(error);
  return (
    type === "InvalidTransaction" ||
    type === "InvalidNonce" ||
    /InvalidTransaction|InvalidNonce/.test(msg)
  );
}

export function isOnChainExecutionError(error: unknown): boolean {
  return /FunctionCallError|ExecutionError|GuestPanic|SG_E\d+/.test(
    errorMessage(error)
  );
}

export function txHashFromUnknown(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "transaction" in error &&
    error.transaction &&
    typeof error.transaction === "object" &&
    "hash" in error.transaction
  ) {
    const hash = (error.transaction as { hash: unknown }).hash;
    return typeof hash === "string" ? hash : undefined;
  }
  return undefined;
}
