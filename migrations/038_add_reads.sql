CREATE TABLE reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  date_started TEXT,
  date_finished TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO reads (book_id, date_started, date_finished)
SELECT id, date_started, date_finished
FROM books
WHERE date_started IS NOT NULL OR date_finished IS NOT NULL;
