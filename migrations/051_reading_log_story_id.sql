-- Stories Layer 3 pass 1: story attribution on reading_log.
--
-- Adds story_id (nullable, set-null on story delete to preserve historical
-- page totals) and replaces the inline UNIQUE(book_id, date) constraint
-- with a pair of partial unique indexes so book-level and story-level
-- rows can coexist for the same day:
--
--   - Book-level rows (story_id IS NULL): unique on (book_id, date), so
--     the patchBook upsert in lib/books/repository.js continues to merge
--     same-day pages.
--   - Story-level rows (story_id IS NOT NULL): unique on
--     (book_id, date, story_id), idempotent against a story being
--     "finished" twice on the same day.
--
-- SQLite has no DROP CONSTRAINT, so we rebuild the table.
PRAGMA foreign_keys = OFF;

CREATE TABLE reading_log_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  story_id     INTEGER REFERENCES stories(id) ON DELETE SET NULL,
  date         TEXT NOT NULL,
  pages_read   INTEGER NOT NULL DEFAULT 0,
  minutes_read INTEGER NOT NULL DEFAULT 0
);

INSERT INTO reading_log_new (id, book_id, story_id, date, pages_read, minutes_read)
SELECT id, book_id, NULL, date, pages_read, minutes_read FROM reading_log;

DROP TABLE reading_log;
ALTER TABLE reading_log_new RENAME TO reading_log;

CREATE UNIQUE INDEX idx_reading_log_book_date_book_level
  ON reading_log(book_id, date) WHERE story_id IS NULL;
CREATE UNIQUE INDEX idx_reading_log_book_date_story
  ON reading_log(book_id, date, story_id) WHERE story_id IS NOT NULL;

PRAGMA foreign_keys = ON;
