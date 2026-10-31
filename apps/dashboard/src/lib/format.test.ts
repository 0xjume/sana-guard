import { describe, expect, it } from 'vitest';
import {
  formatDurationNs,
  hoursToNs,
  lamportsToSol,
  nearToYocto,
  nsToHours,
  shortenAddress,
  solToLamports,
  yoctoToNear,
} from './format';

describe('format', () => {
  it('converts SOL and lamports without float rounding', () => {
    expect(solToLamports('0.05')).toBe(50_000_000n);
    expect(solToLamports('1.000000001')).toBe(1_000_000_001n);
    expect(lamportsToSol(50_000_000n)).toBe('0.05');
    expect(lamportsToSol(1_000_000_000n)).toBe('1');
  });

  it('rejects invalid SOL amounts', () => {
    expect(() => solToLamports('-1')).toThrow(/non-negative/);
    expect(() => solToLamports('abc')).toThrow(/non-negative/);
    expect(() => solToLamports('1.0000000001')).toThrow(/9 decimal/);
  });

  it('converts NEAR and yocto', () => {
    expect(nearToYocto('0.15')).toBe(150_000_000_000_000_000_000_000n);
    expect(yoctoToNear(500_000_000_000_000_000_000_000n)).toBe('0.5');
  });

  it('formats durations and delay hours', () => {
    expect(hoursToNs('1')).toBe(3_600_000_000_000n);
    expect(nsToHours(3_600_000_000_000n)).toBe('1');
    expect(nsToHours(3_661_000_000_000n)).toBe('1.016944444');
    expect(hoursToNs(nsToHours(3_600_000_000_000n))).toBe(3_600_000_000_000n);
    expect(formatDurationNs(3_600_000_000_000n)).toBe('1h');
    expect(formatDurationNs(0n)).toBe('0s');
  });

  it('shortens addresses', () => {
    expect(shortenAddress('DeF8KCnMiARMuEUjc1iD4wGh8g8D7ygSUVGnYw8XMvmB')).toBe('DeF8…MvmB');
  });
});
