import { describe, expect, it } from 'vitest';
import { VAULT_FOLLOW_UP_REFRESH_MS, planVaultRefresh } from './vault-refresh';

describe('planVaultRefresh', () => {
  it('refreshes immediately and again after finality can catch up', () => {
    const ran: string[] = [];
    const scheduled: number[] = [];
    planVaultRefresh(
      () => ran.push('now'),
      (ms, run) => {
        scheduled.push(ms);
        ran.push(`later:${ms}`);
        run();
      }
    );
    expect(scheduled).toEqual([...VAULT_FOLLOW_UP_REFRESH_MS]);
    expect(ran).toEqual(['now', 'later:2000', 'now', 'later:4000', 'now']);
  });
});
