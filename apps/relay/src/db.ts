import Database from "better-sqlite3";
import { logger } from "./logger.js";
import { Mutex } from "./mutex.js";

export interface OwnerStats {
  owner: string;
  requestCount1h: number;
  spentToday: string;
}

export interface GlobalStats {
  spentToday: string;
}

export class RelayDatabase {
  private db: Database.Database;
  private readonly ownerMutexes = new Map<string, Mutex>();

  constructor(databaseUrl: string) {
    if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
      throw new Error(
        "Postgres is not supported. Use DATABASE_URL=sqlite:<path> and a Railway volume for the file."
      );
    }
    const dbPath = databaseUrl.replace(/^sqlite:/, "");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS owner_requests (
        owner TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        nonce INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        spent_yocto TEXT NOT NULL,
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

  withOwnerLock<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    let mutex = this.ownerMutexes.get(owner);
    if (!mutex) {
      mutex = new Mutex();
      this.ownerMutexes.set(owner, mutex);
    }
    return mutex.run(fn);
  }

  checkNonceInFlight(owner: string, nonce: number): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM owner_requests
         WHERE owner = ? AND nonce = ? AND status = 'pending'`
      )
      .get(owner, nonce) as { count: number } | undefined;

    return (row?.count ?? 0) > 0;
  }

  reserveBudget(
    owner: string,
    nonce: number,
    actionType: string,
    spentYocto: string,
    nowMs: number
  ): void {
    const today = new Date(nowMs).toISOString().split("T")[0];

    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO owner_requests (owner, timestamp, nonce, action_type, spent_yocto, tx_hash, success, status)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, 'pending')`
        )
        .run(owner, nowMs, nonce, actionType, spentYocto);

      const existing = this.db
        .prepare(`SELECT spent_yocto FROM global_stats WHERE date = ?`)
        .get(today) as { spent_yocto: string } | undefined;

      if (existing) {
        const newTotal = (BigInt(existing.spent_yocto) + BigInt(spentYocto)).toString();
        this.db
          .prepare(`UPDATE global_stats SET spent_yocto = ? WHERE date = ?`)
          .run(newTotal, today);
      } else {
        this.db
          .prepare(`INSERT INTO global_stats (date, spent_yocto) VALUES (?, ?)`)
          .run(today, spentYocto);
      }
    });
    txn();
  }

  finalizeBudget(
    owner: string,
    nonce: number,
    txHash: string,
    success: boolean
  ): void {
    this.db
      .prepare(
        `UPDATE owner_requests SET tx_hash = ?, success = ?, status = 'completed'
         WHERE owner = ? AND nonce = ? AND status = 'pending'`
      )
      .run(txHash, success ? 1 : 0, owner, nonce);
  }

  releaseBudget(owner: string, nonce: number, nowMs: number): void {
    const today = new Date(nowMs).toISOString().split("T")[0];

    const txn = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT spent_yocto FROM owner_requests
           WHERE owner = ? AND nonce = ? AND status = 'pending'`
        )
        .get(owner, nonce) as { spent_yocto: string } | undefined;

      if (!row) return;

      this.db
        .prepare(
          `UPDATE owner_requests SET status = 'released'
           WHERE owner = ? AND nonce = ? AND status = 'pending'`
        )
        .run(owner, nonce);

      const existing = this.db
        .prepare(`SELECT spent_yocto FROM global_stats WHERE date = ?`)
        .get(today) as { spent_yocto: string } | undefined;

      if (existing) {
        const next = BigInt(existing.spent_yocto) - BigInt(row.spent_yocto);
        this.db
          .prepare(`UPDATE global_stats SET spent_yocto = ? WHERE date = ?`)
          .run(next < 0n ? "0" : next.toString(), today);
      }
    });
    txn();
  }

  getOwnerStats(owner: string, nowMs: number): OwnerStats {
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const today = new Date(nowMs).toISOString().split("T")[0];
    const todayStartMs = new Date(today!).getTime();

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
    const today = new Date(nowMs).toISOString().split("T")[0];

    const row = this.db
      .prepare(`SELECT spent_yocto FROM global_stats WHERE date = ?`)
      .get(today) as { spent_yocto: string } | undefined;

    return {
      spentToday: row?.spent_yocto ?? "0",
    };
  }

  getActionCountToday(actionType: string, nowMs: number): number {
    const today = new Date(nowMs).toISOString().split("T")[0];
    const todayStartMs = new Date(today!).getTime();

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
      .prepare(`DELETE FROM owner_requests WHERE timestamp < ?`)
      .run(beforeMs);

    logger.info(
      { deletedRows: deleted.changes, beforeMs },
      "Cleaned up old request records"
    );
  }

  close(): void {
    this.db.close();
  }
}
