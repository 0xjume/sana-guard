const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 8;

export function trustedClientIp(headers: Headers): string {
  const vercel = headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (vercel) {
    return vercel;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) {
    return real;
  }
  return 'local';
}

export function pruneRateStore(store: Map<string, number[]>, now: number, windowMs: number): void {
  for (const [key, stamps] of store) {
    const recent = stamps.filter((stamp) => now - stamp < windowMs);
    if (recent.length === 0) {
      store.delete(key);
    } else {
      store.set(key, recent);
    }
  }
}

export function allowRateLimited(
  store: Map<string, number[]>,
  key: string,
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX
): boolean {
  pruneRateStore(store, now, windowMs);
  const recent = store.get(key) ?? [];
  if (recent.length >= max) {
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}
