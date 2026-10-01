import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './lib/migrations/runner.js';
import { measureCoverBytes } from './lib/books/covers.js';
import { nrm } from './shared/text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, 'spine.db');
const db = new Database(dbPath);
const isInMemoryDb = dbPath === ':memory:';

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Apply pending migrations. The runner snapshots the DB before each
// migration (so a destructive one can be rolled back), runs the
// migration with the FK-disable gate (see lib/migrations/applyMigration.js
// for the 2026-05-09 cascade story), then bracket-checks the batch
// with a row-count sanity test that throws if any non-empty table
// dropped to 0. Pre-snapshots in backups/ are pruned after 90 days.
runMigrations({
  db,
  migrationsDir: path.join(__dirname, 'migrations'),
  snapshotDir:   path.join(__dirname, 'backups'),
  isInMemory:    isInMemoryDb,
  retainDays:    90,
});

// One-shot backfill for the cover_bytes column added in migration 065.
// Pure SQL migrations can't fs.statSync, so the fill happens here at
// startup. Idempotent — only touches rows that still have a NULL
// cover_bytes despite a non-empty cover_path. measureCoverBytes returns
// null for missing/unreadable files, which is also written so we don't
// re-scan a known-broken path on the next start.
{
  const unfilled = db.prepare(
    "SELECT id, cover_path FROM books WHERE cover_path IS NOT NULL AND cover_path != '' AND cover_bytes IS NULL"
  ).all();
  if (unfilled.length > 0) {
    const upd = db.prepare('UPDATE books SET cover_bytes = ? WHERE id = ?');
    db.transaction(() => {
      for (const { id, cover_path } of unfilled) {
        upd.run(measureCoverBytes(cover_path), id);
      }
    })();
  }
}

// nrm (search-text folding) lives in shared/text.js so the client uses the
// exact same implementation; re-exported here for existing server imports.
export { nrm };


db.function('nrm', { deterministic: true }, (s) => nrm(s));

export default db;
