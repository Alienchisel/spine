// Post-migration sanity check. Snapshots row counts of every user
// table and diffs pre/post to catch the 2026-05-09-style cascade
// where a migration's DROP TABLE silently emptied every junction
// table because PRAGMA foreign_keys = OFF was a no-op inside a
// transaction.
//
// Extracted so the diff logic can be unit-tested without standing
// up the full db.js import side effects.

export function snapshotRowCounts(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations'"
  ).all();
  const counts = new Map();
  for (const { name } of tables) {
    counts.set(name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n);
  }
  return counts;
}

// Diff two row-count snapshots and surface non-empty tables that were
// wiped to zero. Tables present in `before` but absent from `after`
// are intentionally skipped: a migration that drops or renames a table
// is not the bug we're guarding against. The cascade case the check
// exists for keeps the junction tables in place — only their rows
// vanish.
export function diffRowCounts(before, after) {
  const wiped = [];
  for (const [table, beforeCount] of before) {
    if (beforeCount === 0) continue;
    if (!after.has(table)) continue;
    if (after.get(table) === 0) {
      wiped.push(`${table}: ${beforeCount} → 0`);
    }
  }
  return { wiped };
}
