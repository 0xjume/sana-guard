import { timingSafeEqual } from 'node:crypto';
import { allowRateLimited, trustedClientIp } from './rate-limit';

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
  return trustedClientIp(request.headers);
}

export function allowAttackLabRequest(
  key: string,
  now = Date.now(),
  store: Map<string, number[]> = hits
): boolean {
  return allowRateLimited(store, key, now, WINDOW_MS, MAX_REQUESTS);
}

export function resetAttackLabRateLimit(store: Map<string, number[]> = hits): void {
  store.clear();
}
