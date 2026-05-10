import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { makeApplyMigration } from './lib/migrations/applyMigration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, 'spine.db');
const db = new Database(dbPath);
const isInMemoryDb = dbPath === ':memory:';

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )
`);

const applied = new Set(
  db.prepare('SELECT name FROM migrations').all().map(r => r.name)
);

const migrationsDir = path.join(__dirname, 'migrations');
if (!fs.existsSync(migrationsDir)) throw new Error(`Missing migrations directory: ${migrationsDir}`);
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

// Migration runner — see lib/migrations/applyMigration.js. Migrations
// containing `PRAGMA foreign_keys = OFF` bypass the wrapping transaction
// because SQLite silently ignores foreign_keys toggling inside a txn,
// which would let DROP TABLE cascade through every junction table (the
// 2026-05-09 incident). Regression test in test/migrations.test.js.
const applyMigration = makeApplyMigration(db);

// Pre-migration snapshot directory. Each pending migration writes a
// VACUUM INTO snapshot named `spine-pre-<migration>-<ts>.db` before
// being applied — so a destructive migration can be rolled back to the
// exact state immediately preceding it. Cheap (DB is small, snapshots
// are infrequent) and the naming makes forensics trivial. Retention is
// handled out-of-band by a `find ... -mtime +N -delete` cron entry.
// Skipped for in-memory DBs (tests) — there's no underlying file to
// preserve and millisecond-tight test loops would collide on filenames.
const preMigrationDir = path.join(__dirname, 'backups');
const hasPendingMigrations = files.some(f => !applied.has(f));
const shouldSnapshotMigrations = !isInMemoryDb && hasPendingMigrations;
if (shouldSnapshotMigrations && !fs.existsSync(preMigrationDir)) {
  fs.mkdirSync(preMigrationDir, { recursive: true });
}

// Snapshot row counts for every user table. Used to bracket the migration
// loop with a sanity check: if any table that had rows BEFORE the batch is
// empty AFTER, abort startup (the 2026-05-09 cascade incident left every
// junction table at 0 rows; this would have caught it within seconds).
function snapshotRowCounts() {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations'"
  ).all();
  const counts = new Map();
  for (const { name } of tables) {
    counts.set(name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n);
  }
  return counts;
}

const preCounts = hasPendingMigrations ? snapshotRowCounts() : null;

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  let snapshotPath = null;
  if (shouldSnapshotMigrations) {
    // VACUUM INTO is the supported online-backup primitive: a consistent
    // compact copy including WAL state, written via SQL (no shell-out).
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    snapshotPath = path.join(
      preMigrationDir,
      `spine-pre-${file.replace(/\.sql$/, '')}-${ts}.db`,
    );
    try {
      db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
      console.log(`Snapshot before ${file}: ${snapshotPath}`);
    } catch (err) {
      console.error(`Failed pre-migration snapshot for ${file}: ${err.message}`);
      throw err;
    }
  }
  try {
    applyMigration(file, sql);
    console.log(`Applied migration: ${file}`);
  } catch (err) {
    console.error(`Failed migration: ${file}${snapshotPath ? ` (pre-snapshot at ${snapshotPath})` : ''}`);
    throw err;
  }
}

// Post-migration sanity check. Throw if any non-empty table dropped to 0
// rows after the migration batch. This is the canary for accidental
// cascade-style data loss (e.g. DROP TABLE inside a transaction with
// PRAGMA foreign_keys silently still on). The error message points at the
// pre-migration snapshot directory so recovery is `cp` away.
if (preCounts) {
  const postCounts = snapshotRowCounts();
  const wiped = [];
  const dropped = [];
  for (const [table, before] of preCounts) {
    if (before === 0) continue;
    const after = postCounts.get(table) ?? 0;
    if (after === 0) {
      wiped.push(`${table}: ${before} → 0`);
    } else if (after < before / 2) {
      dropped.push(`${table}: ${before} → ${after}`);
    }
  }
  if (dropped.length) {
    console.warn(`Migration batch shrank tables by >50%: ${dropped.join(', ')}`);
  }
  if (wiped.length) {
    throw new Error(
      `Migration batch wiped non-empty tables: ${wiped.join(', ')}. ` +
      `Pre-migration snapshots are in ${preMigrationDir} — restore the relevant ` +
      `spine-pre-*.db over spine.db before retrying.`
    );
  }
}

// nrm(text): lowercase + strip combining diacritics + fold a handful of
// non-decomposing ligatures (æ→ae, œ→oe, ß→ss, ø→o, ð→d, þ→th). Used by
// the search-bar LIKE clauses on both sides of the comparison so a query
// for "thermae romae" matches stored "Thermæ Rōmæ", "café" matches
// "cafe", etc. Cheap enough to run per-row at query time at this scale —
// the LIKE is already non-indexable due to the leading wildcard.
export function nrm(s) {
  if (s == null) return null;
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/ø/g, 'o').replace(/ð/g, 'd').replace(/þ/g, 'th');
}

db.function('nrm', { deterministic: true }, (s) => nrm(s));

export default db;
