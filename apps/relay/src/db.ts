import Database from 'better-sqlite3';
import { logger } from './logger.js';
import { Mutex } from './mutex.js';
import type { Config } from './config.js';
import type { AdminAction } from './validation.js';
import { checkActionLimits, checkBudgets } from './budget.js';

export interface OwnerStats {
  owner: string;
  requestCount1h: number;
  spentToday: string;
}

export interface GlobalStats {
  spentToday: string;
}

export interface UnknownReservation {
  owner: string;
  nonce: number;
  txHash: string | null;
  spentYocto: string;
  reservedYocto: string;
  depositYocto: string | null;
  expiresAtMs: number | null;
  timestamp: number;
}

const MAX_OWNER_LOCKS = 256;

export function utcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().split('T')[0]!;
}

function reservedAmount(row: { reservedYocto?: string | null; spentYocto: string }): string {
  return row.reservedYocto || row.spentYocto;
}

function knownDeposit(row: { depositYocto: string | null }): string | null {
  if (row.depositYocto == null || row.depositYocto === '') return null;
  return row.depositYocto;
}

export class RelayDatabase {
  private db: Database.Database;
  private readonly ownerMutexes = new Map<string, Mutex>();
  private readonly globalMutex = new Mutex();

  constructor(databaseUrl: string) {
    if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
      throw new Error(
        'Postgres is not supported. Use DATABASE_URL=sqlite:<path> and a Railway volume for the file.'
      );
    }
    const dbPath = databaseUrl.replace(/^sqlite:/, '');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
    this.migrate();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS owner_requests (
        owner TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        nonce INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        spent_yocto TEXT NOT NULL,
        reserved_yocto TEXT,
        deposit_yocto TEXT,
        expires_at_ms INTEGER,
        tx_hash TEXT,
        success INTEGER,
        status TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_owner_requests_owner_time
        ON owner_requests(owner, timestamp);

      CREATE INDEX IF NOT EXISTS idx_owner_requests_nonce
        ON owner_requests(owner, nonce, status);

      CREATE INDEX IF NOT EXISTS idx_owner_requests_action
        ON owner_requests(action_type, timestamp);

      CREATE TABLE IF NOT EXISTS global_stats (
        date TEXT PRIMARY KEY,
        spent_yocto TEXT NOT NULL
      );
    `);
  }

  private migrate(): void {
    const cols = this.db.prepare(`PRAGMA table_info(owner_requests)`).all() as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === 'reserved_yocto')) {
      this.db.exec(`ALTER TABLE owner_requests ADD COLUMN reserved_yocto TEXT`);
    }
    if (!cols.some((c) => c.name === 'deposit_yocto')) {
      this.db.exec(`ALTER TABLE owner_requests ADD COLUMN deposit_yocto TEXT`);
    }
    if (!cols.some((c) => c.name === 'expires_at_ms')) {
      this.db.exec(`ALTER TABLE owner_requests ADD COLUMN expires_at_ms INTEGER`);
    }
  }

  withGlobalLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.globalMutex.run(fn);
  }

  withOwnerLock<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    this.evictOwnerLocks();
    let mutex = this.ownerMutexes.get(owner);
    if (!mutex) {
      mutex = new Mutex();
      this.ownerMutexes.set(owner, mutex);
    }
    return mutex.run(fn);
  }

  ownerLockCount(): number {
    return this.ownerMutexes.size;
  }

  private evictOwnerLocks(): void {
    if (this.ownerMutexes.size < MAX_OWNER_LOCKS) return;
    for (const [key, mutex] of this.ownerMutexes) {
      if (!mutex.isBusy) {
        this.ownerMutexes.delete(key);
      }
      if (this.ownerMutexes.size < MAX_OWNER_LOCKS) return;
    }
  }

  /** Sum of pending + unknown reservations (not yet reconciled or released). */
  getOutstandingReservedYocto(): string {
    const rows = this.db
      .prepare(`SELECT spent_yocto FROM owner_requests WHERE status IN ('pending', 'unknown')`)
      .all() as Array<{ spent_yocto: string }>;
    let total = 0n;
    for (const row of rows) {
      total += BigInt(row.spent_yocto);
    }
    return total.toString();
  }

  checkNonceInFlight(owner: string, nonce: number): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM owner_requests
         WHERE owner = ? AND nonce = ? AND status IN ('pending', 'unknown')`
      )
      .get(owner, nonce) as { count: number } | undefined;

    return (row?.count ?? 0) > 0;
  }

  tryReserveBudget(args: {
    owner: string;
    nonce: number;
    action: AdminAction;
    depositYocto: string;
    gasCostYocto: string;
    nowMs: number;
    expiresAtMs?: number;
    config: Config;
  }): { ok: true } | { ok: false; reason: string } {
    const spentYocto = (BigInt(args.depositYocto) + BigInt(args.gasCostYocto)).toString();

    return this.db.transaction(() => {
      if (this.checkNonceInFlight(args.owner, args.nonce)) {
        return { ok: false as const, reason: 'Request with same nonce already in progress' };
      }

      const actionCheck = checkActionLimits(args.action, this, args.nowMs);
      if (!actionCheck.allowed) {
        return { ok: false as const, reason: actionCheck.reason ?? 'limit' };
      }

      const budgetCheck = checkBudgets(
        args.owner,
        args.depositYocto,
        args.gasCostYocto,
        this,
        args.config,
        args.nowMs
      );
      if (!budgetCheck.allowed) {
        return { ok: false as const, reason: budgetCheck.reason ?? 'budget' };
      }

      this.insertReservation({
        owner: args.owner,
        nonce: args.nonce,
        actionType: args.action.type,
        spentYocto,
        depositYocto: args.depositYocto,
        nowMs: args.nowMs,
        expiresAtMs: args.expiresAtMs,
      });
      return { ok: true as const };
    })();
  }

  reserveBudget(
    owner: string,
    nonce: number,
    actionType: string,
    spentYocto: string,
    nowMs: number,
    extras: { depositYocto?: string | null; expiresAtMs?: number } = {}
  ): void {
    const txn = this.db.transaction(() => {
      this.insertReservation({
        owner,
        nonce,
        actionType,
        spentYocto,
        depositYocto: extras.depositYocto === undefined ? '0' : extras.depositYocto,
        nowMs,
        expiresAtMs: extras.expiresAtMs,
      });
    });
    txn();
  }

  private insertReservation(args: {
    owner: string;
    nonce: number;
    actionType: string;
    spentYocto: string;
    depositYocto: string | null;
    nowMs: number;
    expiresAtMs?: number;
  }): void {
    const today = utcDate(args.nowMs);

    this.db
      .prepare(
        `INSERT INTO owner_requests (owner, timestamp, nonce, action_type, spent_yocto, reserved_yocto, deposit_yocto, expires_at_ms, tx_hash, success, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending')`
      )
      .run(
        args.owner,
        args.nowMs,
        args.nonce,
        args.actionType,
        args.spentYocto,
        args.spentYocto,
        args.depositYocto,
        args.expiresAtMs ?? null
      );

    const existing = this.db
      .prepare(`SELECT spent_yocto FROM global_stats WHERE date = ?`)
      .get(today) as { spent_yocto: string } | undefined;

    if (existing) {
      const newTotal = (BigInt(existing.spent_yocto) + BigInt(args.spentYocto)).toString();
      this.db
        .prepare(`UPDATE global_stats SET spent_yocto = ? WHERE date = ?`)
        .run(newTotal, today);
    } else {
      this.db
        .prepare(`INSERT INTO global_stats (date, spent_yocto) VALUES (?, ?)`)
        .run(today, args.spentYocto);
    }
  }

  attachTxHash(owner: string, nonce: number, txHash: string): void {
    this.db
      .prepare(
        `UPDATE owner_requests SET tx_hash = ?
         WHERE owner = ? AND nonce = ? AND status IN ('pending', 'unknown')`
      )
      .run(txHash, owner, nonce);
  }

  finalizeBudget(owner: string, nonce: number, txHash: string, success: boolean): void {
    this.db
      .prepare(
        `UPDATE owner_requests SET tx_hash = ?, success = ?, status = 'completed'
         WHERE owner = ? AND nonce = ? AND status IN ('pending', 'unknown')`
      )
      .run(txHash, success ? 1 : 0, owner, nonce);
  }

  /**
   * Replace the reserved spend with the actual amount.
   * Adjusts the global total for the row's own UTC date, not "today".
   */
  reconcileBudget(
    owner: string,
    nonce: number,
    actualSpentYocto: string,
    txHash: string,
    success: boolean | null,
    _nowMs: number,
    opts: { status?: 'completed' | 'settled-unverified' } = {}
  ): void {
    const status = opts.status ?? 'completed';

    const txn = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT spent_yocto, timestamp FROM owner_requests
           WHERE owner = ? AND nonce = ? AND status IN ('pending', 'unknown')`
        )
        .get(owner, nonce) as { spent_yocto: string; timestamp: number } | undefined;

      if (!row) return;

      const delta = BigInt(actualSpentYocto) - BigInt(row.spent_yocto);
      const rowDay = utcDate(row.timestamp);

      this.db
        .prepare(
          `UPDATE owner_requests
           SET spent_yocto = ?, tx_hash = ?, success = ?, status = ?
           WHERE owner = ? AND nonce = ? AND status IN ('pending', 'unknown')`
        )
        .run(
          actualSpentYocto,
          txHash,
          success === null ? null : success ? 1 : 0,
          status,
          owner,
          nonce
        );

      this.applyGlobalDelta(rowDay, delta);
    });
    txn();
  }

  private applyGlobalDelta(day: string, delta: bigint): void {
    const existing = this.db
      .prepare(`SELECT spent_yocto FROM global_stats WHERE date = ?`)
      .get(day) as { spent_yocto: string } | undefined;

    if (existing) {
      const next = BigInt(existing.spent_yocto) + delta;
      this.db
        .prepare(`UPDATE global_stats SET spent_yocto = ? WHERE date = ?`)
        .run(next < 0n ? '0' : next.toString(), day);
      return;
    }
    if (delta > 0n) {
      this.db
        .prepare(`INSERT INTO global_stats (date, spent_yocto) VALUES (?, ?)`)
        .run(day, delta.toString());
    }
  }

  markUnknown(owner: string, nonce: number, txHash?: string): void {
    this.db
      .prepare(
        `UPDATE owner_requests SET status = 'unknown', tx_hash = COALESCE(?, tx_hash)
         WHERE owner = ? AND nonce = ? AND status = 'pending'`
      )
      .run(txHash ?? null, owner, nonce);
  }

  /**
   * Resolve 'unknown' rows.
   * - With a hash: check txStatus. Record deposit+burnt on success, burnt only on failure.
   * - Still pending/UNKNOWN after expiry + tx validity: settle via nonce
   *   (release if unused). A nonce bump is not proof this row landed —
   *   re-check the stored hash first; if still unknown, keep the reserved
   *   amount and mark settled-unverified.
   * - Without a hash (legacy): same expiry + nonce path.
   */
  async resolveUnknownReservations(args: {
    checkTx: (txHash: string) => Promise<{
      status: 'success' | 'failure' | 'pending' | 'unknown';
      tokensBurntYocto?: string;
    }>;
    checkOwnerNonce: (owner: string) => Promise<number>;
    nowMs: number;
    txValidityMs: number;
  }): Promise<number> {
    let resolved = 0;
    for (const row of this.listUnknownReservations()) {
      if (row.txHash) {
        const result = await args.checkTx(row.txHash);
        if (result.status === 'success' || result.status === 'failure') {
          this.applyTxOutcome(
            row,
            { status: result.status, tokensBurntYocto: result.tokensBurntYocto },
            args.nowMs
          );
          resolved++;
          continue;
        }
      }

      const settleAfter = (row.expiresAtMs ?? row.timestamp) + args.txValidityMs;
      if (args.nowMs < settleAfter) continue;

      await this.settleExpiredReservation(row, args);
      resolved++;
    }
    return resolved;
  }

  private applyTxOutcome(
    row: UnknownReservation,
    result: {
      status: 'success' | 'failure';
      tokensBurntYocto?: string;
    },
    nowMs: number
  ): void {
    const burnt = result.tokensBurntYocto ?? '0';
    const deposit = knownDeposit(row);
    const actual =
      result.status === 'success'
        ? deposit != null
          ? (BigInt(deposit) + BigInt(burnt)).toString()
          : reservedAmount(row)
        : burnt;
    this.reconcileBudget(
      row.owner,
      row.nonce,
      actual,
      row.txHash ?? 'settled-by-nonce',
      result.status === 'success',
      nowMs
    );
  }

  private async settleExpiredReservation(
    row: UnknownReservation,
    args: {
      checkTx: (txHash: string) => Promise<{
        status: 'success' | 'failure' | 'pending' | 'unknown';
        tokensBurntYocto?: string;
      }>;
      checkOwnerNonce: (owner: string) => Promise<number>;
      nowMs: number;
    }
  ): Promise<void> {
    if (row.txHash) {
      const again = await args.checkTx(row.txHash);
      if (again.status === 'success' || again.status === 'failure') {
        this.applyTxOutcome(
          row,
          { status: again.status, tokensBurntYocto: again.tokensBurntYocto },
          args.nowMs
        );
        return;
      }
    }

    const onChainNonce = await args.checkOwnerNonce(row.owner);
    if (onChainNonce >= row.nonce) {
      // Nonce moved, but that is not proof this row's tx landed. Keep the
      // full reserved amount (deposit + gas) so spend is never under-counted.
      this.reconcileBudget(
        row.owner,
        row.nonce,
        reservedAmount(row),
        row.txHash ?? 'settled-unverified',
        null,
        args.nowMs,
        { status: 'settled-unverified' }
      );
    } else {
      this.releaseBudget(row.owner, row.nonce, args.nowMs);
    }
  }

  listUnknownReservations(): UnknownReservation[] {
    return this.db
      .prepare(
        `SELECT owner, nonce, tx_hash as txHash, spent_yocto as spentYocto,
                COALESCE(reserved_yocto, spent_yocto) as reservedYocto,
                deposit_yocto as depositYocto,
                expires_at_ms as expiresAtMs, timestamp
         FROM owner_requests WHERE status = 'unknown'`
      )
      .all() as UnknownReservation[];
  }

  getRequest(
    owner: string,
    nonce: number
  ):
    | {
        status: string;
        spentYocto: string;
        success: number | null;
        txHash: string | null;
        timestamp: number;
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT status, spent_yocto as spentYocto, success,
                tx_hash as txHash, timestamp
         FROM owner_requests WHERE owner = ? AND nonce = ?
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get(owner, nonce) as
      | {
          status: string;
          spentYocto: string;
          success: number | null;
          txHash: string | null;
          timestamp: number;
        }
      | undefined;
  }

  releaseBudget(owner: string, nonce: number, _nowMs: number): void {
    const txn = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT spent_yocto, timestamp FROM owner_requests
           WHERE owner = ? AND nonce = ? AND status IN ('pending', 'unknown')`
        )
        .get(owner, nonce) as { spent_yocto: string; timestamp: number } | undefined;

      if (!row) return;

      this.db
        .prepare(
          `UPDATE owner_requests SET status = 'released'
           WHERE owner = ? AND nonce = ? AND status IN ('pending', 'unknown')`
        )
        .run(owner, nonce);

      this.applyGlobalDelta(utcDate(row.timestamp), -BigInt(row.spent_yocto));
    });
    txn();
  }

  getOwnerStats(owner: string, nowMs: number): OwnerStats {
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const todayStartMs = new Date(utcDate(nowMs)).getTime();

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM owner_requests
         WHERE owner = ? AND timestamp >= ? AND status != 'released'`
      )
      .get(owner, oneHourAgo) as { count: number } | undefined;

    const spentRows = this.db
      .prepare(
        `SELECT spent_yocto FROM owner_requests
         WHERE owner = ? AND timestamp >= ? AND status != 'released'`
      )
      .all(owner, todayStartMs) as Array<{ spent_yocto: string }>;

    let totalSpent = 0n;
    for (const row of spentRows) {
      totalSpent += BigInt(row.spent_yocto);
    }

    return {
      owner,
      requestCount1h: countRow?.count ?? 0,
      spentToday: totalSpent.toString(),
    };
  }

  getGlobalStats(nowMs: number): GlobalStats {
    const today = utcDate(nowMs);

    const row = this.db
      .prepare(`SELECT spent_yocto FROM global_stats WHERE date = ?`)
      .get(today) as { spent_yocto: string } | undefined;

    return {
      spentToday: row?.spent_yocto ?? '0',
    };
  }

  getActionCountToday(actionType: string, nowMs: number): number {
    const todayStartMs = new Date(utcDate(nowMs)).getTime();

    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM owner_requests
         WHERE action_type = ? AND timestamp >= ? AND status != 'released'`
      )
      .get(actionType, todayStartMs) as { count: number } | undefined;

    return row?.count ?? 0;
  }

  cleanupOldData(beforeMs: number): void {
    const deleted = this.db
      .prepare(`DELETE FROM owner_requests WHERE timestamp < ? AND status != 'unknown'`)
      .run(beforeMs);

    logger.info({ deletedRows: deleted.changes, beforeMs }, 'Cleaned up old request records');
  }

  close(): void {
    this.db.close();
  }
}
