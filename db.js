import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'spine.db'));

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

const applyMigration = db.transaction((file, sql) => {
  db.exec(sql);
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
});

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  try {
    applyMigration(file, sql);
    console.log(`Applied migration: ${file}`);
  } catch (err) {
    console.error(`Failed migration: ${file}`);
    throw err;
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
