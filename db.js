import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'spine.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    status TEXT DEFAULT 'unread' CHECK(status IN ('reading', 'finished', 'unread')),
    owned INTEGER NOT NULL DEFAULT 0,
    cover_path TEXT,
    rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),
    date_started TEXT,
    date_finished TEXT,
    acquisition_source TEXT,
    format TEXT CHECK(format IS NULL OR format IN ('physical', 'ebook', 'audiobook')),
    binding TEXT CHECK(binding IS NULL OR binding IN ('paperback', 'hardcover')),
    condition TEXT CHECK(condition IS NULL OR condition IN ('new', 'used')),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS book_tags (
    book_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (book_id, tag_id),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
`);

export default db;
