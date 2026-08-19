// Migration runner — orchestrates the full pre-snapshot + apply +
// post-sanity-check + retention pipeline. Extracted from db.js so the
// orchestration itself can be exercised end-to-end against a temp DB
// in tests, separate from db.js's import-time side effects.

import fs from 'fs';
import path from 'path';
import { makeApplyMigration } from './applyMigration.js';
import { snapshotRowCounts, diffRowCounts } from './sanityCheck.js';

export function runMigrations({
  db,
  migrationsDir,
  snapshotDir,
  isInMemory = false,
  retainDays = 90,
  log = console.log,
}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Missing migrations directory: ${migrationsDir}`);
  }

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name),
  );
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  const pending = files.filter(f => !applied.has(f));
  if (pending.length === 0) return;

  // Skipped for in-memory DBs — there's no underlying file to preserve
  // and millisecond-tight test loops would collide on filenames.
  const shouldSnapshot = !isInMemory && Boolean(snapshotDir);
  if (shouldSnapshot && !fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  const preCounts = snapshotRowCounts(db);
  const applyMigration = makeApplyMigration(db);

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    let snapshotPath = null;
    if (shouldSnapshot) {
      // VACUUM INTO is the supported online-backup primitive: a consistent
      // compact copy including WAL state, written via SQL (no shell-out).
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      snapshotPath = path.join(
        snapshotDir,
        `spine-pre-${file.replace(/\.sql$/, '')}-${ts}.db`,
      );
      try {
        db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
        log(`Snapshot before ${file}: ${snapshotPath}`);
      } catch (err) {
        throw new Error(`Failed pre-migration snapshot for ${file}: ${err.message}`, { cause: err });
      }
    }
    try {
      applyMigration(file, sql);
      log(`Applied migration: ${file}`);
    } catch (err) {
      const detail = snapshotPath ? ` (pre-snapshot at ${snapshotPath})` : '';
      throw new Error(`Failed migration: ${file}${detail}: ${err.message}`, { cause: err });
    }
  }

  // Post-batch sanity check. Throws if any non-empty table dropped to
  // 0 rows — the canary for accidental cascade-style data loss.
  // Tables that no longer exist post-migration (legitimate rename or
  // drop) are intentionally skipped; see sanityCheck.js for the rule.
  const postCounts = snapshotRowCounts(db);
  const { wiped } = diffRowCounts(preCounts, postCounts);
  if (wiped.length) {
    const where = snapshotDir ? `Pre-migration snapshots are in ${snapshotDir} — ` : '';
    throw new Error(
      `Migration batch wiped non-empty tables: ${wiped.join(', ')}. ` +
      `${where}restore the relevant spine-pre-*.db over spine.db before retrying.`,
    );
  }

  // Prune pre-migration snapshots older than the retention window so
  // the directory stays bounded. Only runs after a successful batch
  // (we're past the wiped throw above), so failed-migration forensics
  // aren't swept for at least retainDays afterwards.
  if (shouldSnapshot && retainDays > 0) {
    const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(snapshotDir)) {
      if (!f.startsWith('spine-pre-') || !f.endsWith('.db')) continue;
      const p = path.join(snapshotDir, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch { /* file vanished mid-scan */ }
    }
  }
}
