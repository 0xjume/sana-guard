import Database from "better-sqlite3";
import { logger } from "./logger.js";

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

  constructor(databaseUrl: string) {
    const dbPath = databaseUrl.replace("sqlite:", "");
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
        spent_yocto TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        success INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_owner_requests_owner_time 
        ON owner_requests(owner, timestamp);

      CREATE TABLE IF NOT EXISTS global_stats (
        date TEXT PRIMARY KEY,
        spent_yocto TEXT NOT NULL
      );
    `);
  }

  getOwnerStats(owner: string, nowMs: number): OwnerStats {
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const today = new Date(nowMs).toISOString().split("T")[0];
    const todayStartMs = new Date(today!).getTime();

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM owner_requests 
         WHERE owner = ? AND timestamp >= ?`
      )
      .get(owner, oneHourAgo) as { count: number } | undefined;

    const spentRows = this.db
      .prepare(
        `SELECT spent_yocto FROM owner_requests 
         WHERE owner = ? AND timestamp >= ?`
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

  recordRequest(
    owner: string,
    nonce: number,
    spentYocto: string,
    txHash: string,
    success: boolean,
    nowMs: number
  ): void {
    const today = new Date(nowMs).toISOString().split("T")[0];

    this.db
      .prepare(
        `INSERT INTO owner_requests (owner, timestamp, nonce, spent_yocto, tx_hash, success)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(owner, nowMs, nonce, spentYocto, txHash, success ? 1 : 0);

    const existing = this.db
      .prepare(`SELECT spent_yocto FROM global_stats WHERE date = ?`)
      .get(today) as { spent_yocto: string } | undefined;

    if (existing) {
      const newTotal = (
        BigInt(existing.spent_yocto) + BigInt(spentYocto)
      ).toString();
      this.db
        .prepare(`UPDATE global_stats SET spent_yocto = ? WHERE date = ?`)
        .run(newTotal, today);
    } else {
      this.db
        .prepare(`INSERT INTO global_stats (date, spent_yocto) VALUES (?, ?)`)
        .run(today, spentYocto);
    }
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
