-- Phase 1 of the reading-dates refactor (see docs / 2026-06-28 design
-- audit): the `reads` table is the canonical home for per-read
-- history, but historically the finish-cascade in
-- lib/books/repository.js only fires on the first unread→finished
-- transition, so books finished outside that path (raw SQL backfills,
-- old imports before cascade existed, manual reads-row deletions that
-- were never re-cascaded) can end up status='finished' with
-- read_count >= 1 and zero rows in `reads`. After Phase 1, every
-- finished book must have at least one reads row, because Phase 2
-- will switch every date-reading surface to derive dates from `reads`
-- and the no-row case would silently render as "no read date" instead
-- of the actual book.date_finished value.
--
-- Backfill: for each finished book with zero reads rows, insert one
-- using the book's own date_started/date_finished. NULL when the book
-- itself has no dates — better than fabricating a date, since Phase 2
-- consumers treat NULL as "finished without recorded date" the same
-- way they treat books.date_finished IS NULL today.
--
-- Idempotency: the NOT EXISTS gate skips books that already have a
-- reads row, so re-running the migration is a no-op.

INSERT INTO reads (book_id, date_started, date_finished, did_not_finish, created_at)
SELECT
  b.id,
  b.date_started,
  b.date_finished,
  0,
  datetime('now', 'localtime')
FROM books b
WHERE b.status = 'finished'
  AND NOT EXISTS (SELECT 1 FROM reads r WHERE r.book_id = b.id);
