CREATE TABLE reading_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  date         TEXT NOT NULL,
  pages_read   INTEGER NOT NULL DEFAULT 0,
  minutes_read INTEGER NOT NULL DEFAULT 0,
  UNIQUE(book_id, date)
);
