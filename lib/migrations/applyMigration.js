// Single migration application. Extracted from db.js so we can write
// regression tests against the FK-toggle gate that was the root cause
// of the 2026-05-09 cascade incident.
//
// The runner gates on whether the migration SQL toggles foreign_keys.
// SQLite ignores `PRAGMA foreign_keys` while a transaction is open, so
// migrations that need FK enforcement OFF (table-rebuild pattern) MUST
// run outside any wrapping transaction or the PRAGMA is silently a
// no-op and DROP TABLE will cascade through every junction.
export function makeApplyMigration(db) {
  const txnMigration = db.transaction((file, sql) => {
    db.exec(sql);
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
  });

  return function applyMigration(file, sql) {
    if (/PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(sql)) {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    } else {
      txnMigration(file, sql);
    }
  };
}
