import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './lib/migrations/runner.js';
import { measureCoverBytes } from './lib/books/covers.js';

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

// nrm(text): lowercase + strip combining diacritics + fold a handful of
// non-decomposing ligatures (æ→ae, œ→oe, ß→ss, ø→o, ð→d, þ→th, ł→l, đ→d)
// + collapse curly quotation marks to their straight ASCII equivalents.
// Used by the search-bar LIKE clauses on both sides of the comparison so
// a query for "thermae romae" matches stored "Thermæ Rōmæ", "café"
// matches "cafe", "Stanislaw Lem" matches "Stanisław Lem", and
// "Albion's Seed" (typed with a curly apostrophe from a copy-paste)
// matches stored "Albion's Seed" — the 2026-07-10 miss on Albion's
// Seed traced to nrm not folding U+2019. Cheap enough to run per-row at
// query time at this scale — the LIKE is already non-indexable due to
// the leading wildcard. The Slavic ł / đ pair is included because NFD
// does NOT decompose them (the slash on 'ł' is part of the base
// character, not a combining mark).
export function nrm(s) {
  if (s == null) return null;
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/ø/g, 'o').replace(/ð/g, 'd').replace(/þ/g, 'th')
    .replace(/ł/g, 'l').replace(/đ/g, 'd')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

db.function('nrm', { deterministic: true }, (s) => nrm(s));

export default db;
