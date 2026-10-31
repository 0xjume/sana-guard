type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;

export function registerPrivyAccessTokenGetter(next: TokenGetter | null): void {
  getter = next;
}

export async function readPrivyAccessToken(): Promise<string | null> {
  if (!getter) {
    return null;
  }
  try {
    return await getter();
  } catch {
    return null;
  }
}
