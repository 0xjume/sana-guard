import { timingSafeEqual } from 'node:crypto';

export const ATTACK_LAB_TOKEN_HEADER = 'x-attack-lab-token';
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 8;

const hits = new Map<string, number[]>();

export function attackLabTokensEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function attackLabClientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'local';
}

export function allowAttackLabRequest(
  key: string,
  now = Date.now(),
  store: Map<string, number[]> = hits
): boolean {
  const recent = (store.get(key) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

export function resetAttackLabRateLimit(store: Map<string, number[]> = hits): void {
  store.clear();
}
