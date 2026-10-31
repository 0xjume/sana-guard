import { createHash, timingSafeEqual } from 'crypto';

/** Constant-time string compare via SHA-256 then timingSafeEqual. */
export function tokensEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
