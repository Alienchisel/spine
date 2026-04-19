import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'spine.db'));

db.pragma('journal_mode = WAL');
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

export default db;
