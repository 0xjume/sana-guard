import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { unlink } from 'fs/promises';
import { PENDING_STALE_GRACE_MS, RelayDatabase } from './db.js';
import { recoverOrphanedReservations } from './startup.js';
import { CREATE_VAULT_DEPOSIT } from './constants.js';

const OWNER = 'owner-recovery';
const SPENT = CREATE_VAULT_DEPOSIT.toString();

describe('pending reservation recovery', () => {
  let db: RelayDatabase;
  const now = 1_700_000_000_000;

  beforeEach(() => {
    db = new RelayDatabase('sqlite:./test-pending-recovery.db');
  });

  afterEach(async () => {
    db.close();
    await unlink('./test-pending-recovery.db').catch(() => {});
  });

  it('startup conversion promotes leftover pending rows to unknown and keeps any hash', () => {
    db.reserveBudget(OWNER, 1, 'CreateVault', SPENT, now, {
      expiresAtMs: now + 10 * 60 * 1000,
    });
    db.attachTxHash(OWNER, 1, 'crash-hash');
    db.reserveBudget(OWNER, 2, 'Pause', '100', now);

    const reservedBefore = db.getOutstandingReservedYocto();
    const globalBefore = db.getGlobalStats(now);
    const promoted = recoverOrphanedReservations(db);

    expect(promoted).toBe(2);
    expect(db.getRequest(OWNER, 1)?.status).toBe('unknown');
    expect(db.getRequest(OWNER, 1)?.txHash).toBe('crash-hash');
    expect(db.getRequest(OWNER, 2)?.status).toBe('unknown');
    expect(db.getOutstandingReservedYocto()).toBe(reservedBefore);
    expect(db.getGlobalStats(now)).toEqual(globalBefore);
  });

  it('does not treat a pending CreateVault older than expiry + grace as in-flight', () => {
    const expired = now - 10 * 60 * 1000;
    db.reserveBudget(OWNER, 1, 'CreateVault', SPENT, expired, {
      expiresAtMs: expired,
    });

    expect(db.hasCreateVaultInFlight(OWNER, now)).toBe(false);
    expect(db.getRequest(OWNER, 1)?.status).toBe('unknown');
    expect(db.getOutstandingReservedYocto()).toBe(SPENT);
  });

  it('still treats a fresh pending CreateVault as in-flight', () => {
    db.reserveBudget(OWNER, 1, 'CreateVault', SPENT, now, {
      expiresAtMs: now + 10 * 60 * 1000,
    });
    expect(db.hasCreateVaultInFlight(OWNER, now)).toBe(true);
    expect(db.getRequest(OWNER, 1)?.status).toBe('pending');
  });

  it('still treats a fresh unknown CreateVault as in-flight after startup promotion', () => {
    db.reserveBudget(OWNER, 1, 'CreateVault', SPENT, now, {
      expiresAtMs: now + 10 * 60 * 1000,
    });
    recoverOrphanedReservations(db);
    expect(db.getRequest(OWNER, 1)?.status).toBe('unknown');
    expect(db.hasCreateVaultInFlight(OWNER, now)).toBe(true);
  });

  it('ignores a stale unknown CreateVault for the in-flight check without releasing budget', () => {
    const expired = now - PENDING_STALE_GRACE_MS - 1;
    db.reserveBudget(OWNER, 1, 'CreateVault', SPENT, expired, {
      expiresAtMs: expired,
    });
    db.markUnknown(OWNER, 1, 'old-hash');

    expect(db.hasCreateVaultInFlight(OWNER, now)).toBe(false);
    expect(db.getRequest(OWNER, 1)?.status).toBe('unknown');
    expect(db.getOutstandingReservedYocto()).toBe(SPENT);
  });
});
