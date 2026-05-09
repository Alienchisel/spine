-- Stories within a collection (short-story collection / anthology). Each row
-- belongs to a parent book and carries its own per-story read state, so the
-- user can track which stories in a collection they've read, rate individual
-- stories, and DNF a story without affecting the collection. Surfaced on
-- BookDetail as a "Contents" section, gated on the Stories / Anthology tags.
CREATE TABLE IF NOT EXISTS stories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id         INTEGER NOT NULL,
  title           TEXT NOT NULL,
  position        INTEGER,
  status          TEXT NOT NULL DEFAULT 'unread',
  date_finished   TEXT,
  rating          REAL,
  did_not_finish  INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stories_book_id ON stories(book_id);
