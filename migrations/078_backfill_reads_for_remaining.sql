-- Phase 3 prep: catch the remaining 22 books that have a date_started
-- or date_finished value on the book row but no reads row at all. The
-- 076 backfill targeted only books in status='finished' (the universe
-- the original audit was scoped to). After that ran, four reading-
-- status books still had date_started without a reads row (mid-read
-- imports that bypassed the cascade) plus a handful of unread rows
-- with stale historical dates. Phase 3 drops books.date_started /
-- date_finished entirely; without this backfill the date information
-- on those 22 books would silently disappear at column-drop time.
--
-- did_not_finish=0 keeps the row meaningful as an incomplete reading
-- session (a date_finished IS NULL row is the canonical 'currently
-- reading' shape after Phase 3). Idempotent via the NOT EXISTS gate.

INSERT INTO reads (book_id, date_started, date_finished, did_not_finish, created_at)
SELECT
  b.id,
  b.date_started,
  b.date_finished,
  0,
  datetime('now', 'localtime')
FROM books b
WHERE (b.date_started IS NOT NULL OR b.date_finished IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM reads r WHERE r.book_id = b.id);
