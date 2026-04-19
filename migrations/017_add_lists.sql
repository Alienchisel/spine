CREATE TABLE lists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE list_books (
  list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  book_id  INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, book_id)
);
