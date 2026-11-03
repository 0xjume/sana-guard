import { describe, expect, it } from 'vitest';
import {
  formatDurationNs,
  formatSol,
  hoursToNs,
  lamportsToSol,
  worstCasePriorityFeeLamports,
  nearToYocto,
  nsToHours,
  pluralizeCount,
  shortenAddress,
  solExactTitle,
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

  it('formats user-facing SOL with at most 4 decimals', () => {
    expect(formatSol(50_000_000n)).toBe('0.05 SOL');
    expect(formatSol(100_000_000n)).toBe('0.1 SOL');
    expect(formatSol(914_598_798n)).toBe('0.9146 SOL');
    expect(formatSol(99_999n)).toBe('< 0.0001 SOL');
    expect(formatSol(0n, { unit: false })).toBe('0');
    expect(solExactTitle(914_598_798n)).toBe('0.914598798 SOL');
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

  it('pluralizes visible counts', () => {
    expect(pluralizeCount(1, 'vault')).toBe('1 vault');
    expect(pluralizeCount(0, 'vault')).toBe('0 vaults');
    expect(pluralizeCount(2, 'vault')).toBe('2 vaults');
  });
});

describe('worstCasePriorityFeeLamports', () => {
  it('multiplies the per-CU cap by the 1.4M CU ceiling', () => {
    expect(worstCasePriorityFeeLamports(1n)).toBe(1_400_000n);
    expect(worstCasePriorityFeeLamports(100_000n)).toBe(140_000_000_000n);
  });

  it('is bounded by the total cap when it is lower', () => {
    expect(worstCasePriorityFeeLamports(100_000n, 1_000_000n)).toBe(1_000_000n);
    expect(worstCasePriorityFeeLamports(1n, 5_000_000n)).toBe(1_400_000n);
  });
});
