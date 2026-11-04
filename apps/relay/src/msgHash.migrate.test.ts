import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { unlink } from 'fs/promises';
import { RelayDatabase, sha256Hex } from './db.js';

const PATH = './test-msg-sha-migrate.db';

describe('msg_sha256 migration', () => {
  let db: RelayDatabase | undefined;

  afterEach(async () => {
    db?.close();
    db = undefined;
    await unlink(PATH).catch(() => {});
    await unlink(`${PATH}-wal`).catch(() => {});
    await unlink(`${PATH}-shm`).catch(() => {});
  });

  it('adds a nullable column on a database created before the column existed', () => {
    const raw = new Database(PATH);
    raw.exec(`
      CREATE TABLE owner_requests (
        owner TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        nonce INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        spent_yocto TEXT NOT NULL,
        tx_hash TEXT,
        success INTEGER,
        status TEXT NOT NULL
      );
    `);
    raw
      .prepare(
        `INSERT INTO owner_requests (owner, timestamp, nonce, action_type, spent_yocto, tx_hash, success, status)
         VALUES ('owner', 1, 4, 'Pause', '1', 'legacy-hash', NULL, 'unknown')`
      )
      .run();
    raw.close();

    db = new RelayDatabase(`sqlite:${PATH}`);
    const legacy = db.getRequest('owner', 4);
    expect(legacy?.msgSha256).toBeNull();
    expect(legacy?.txHash).toBe('legacy-hash');
    expect(legacy?.status).toBe('unknown');

    db.reserveBudget('owner', 5, 'Pause', '1', 2, { msgSha256: sha256Hex('signed-message') });
    expect(db.getRequest('owner', 5)?.msgSha256).toBe(sha256Hex('signed-message'));
  });
});
