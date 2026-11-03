export const GENERIC_PAGE_ERROR =
  'The owner console hit an unexpected error. Your vaults and policy are unchanged.';

export const GENERIC_ROOT_ERROR = 'A root-level error stopped the owner console.';

export function logUnexpectedError(scope: string, error: unknown): void {
  console.error(scope, error);
}

export function publicErrorCopy(
  error: { digest?: string },
  fallback: string
): { message: string; digest?: string } {
  return {
    message: error.digest ? `${fallback} (ref ${error.digest})` : fallback,
    digest: error.digest,
  };
}

export function isPolicyErrorCode(code?: string | null): boolean {
  return Boolean(code && /^(?:SG_)?E\d{3}_[A-Z0-9_]+$/i.test(code));
}

export function ruleNameFromCode(code: string): string {
  const match = code.match(/^(?:SG_)?E0?\d+_(.+)$/i);
  if (!match) {
    return code;
  }
  return match[1]
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
