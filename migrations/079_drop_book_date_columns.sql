-- Phase 3: drop books.date_started and books.date_finished. The reads
-- table is now the single source of truth for reading dates; every
-- query and every render-side surface has been flipped to read from
-- reads (with a transient book-column fallback during Phase 2). After
-- 078 backfills the last few books-with-dates-but-no-reads-row edge
-- cases, the book columns are pure redundancy. Dropping them prevents
-- future code from accidentally writing to a stale source.
--
-- ALTER TABLE DROP COLUMN works on SQLite 3.35+ (March 2021) and the
-- better-sqlite3 in use here ships with a current-enough SQLite that
-- supports the syntax directly — no need for the table-rebuild dance
-- that migration 053 explicitly called out as fragile (writable_schema
-- is blocked by better-sqlite3, but DROP COLUMN is a proper DDL
-- operation that doesn't go through sqlite_master writes).
--
-- The idx_books_date_finished index referenced the column we're about
-- to drop, so it has to go first — SQLite would otherwise fail the
-- DROP COLUMN with "no such column" trying to rebuild the index.
-- idx_reads_book_id_date_finished (migration 077) is on reads, not
-- books, and survives. idx_books_work_id is on work_id and survives.

DROP INDEX IF EXISTS idx_books_date_finished;
ALTER TABLE books DROP COLUMN date_started;
ALTER TABLE books DROP COLUMN date_finished;
