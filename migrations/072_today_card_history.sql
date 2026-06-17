-- Daily Today card history.
--
-- Two jobs:
--   1. Stability per calendar day. Without persisted picks the date-
--      seeded selection in lib/today/card.js drifts if the cohort
--      composition changes mid-day (a book gets marked loved, an
--      acquisition rolls past the 14-day window, etc.) — the mod-N
--      formula would return a different card after lunch than it did
--      at breakfast. Storing the first pick of the day and reading it
--      back on subsequent fetches keeps the card stable.
--   2. Repetition guard. The selection cohort excludes any book that
--      appeared in this table within the last 14 days, so the same
--      book doesn't surface twice in quick succession even when the
--      cohort for its type is small (Rothbard A to Z showing up two
--      days in a row in the smoke test was the originating annoyance).
--
-- Only the (date, type, book_id) tuple is stored. Card body text and
-- per-type meta (author stats, days-since-finished, etc.) are
-- recomputed on every request from current book state — so a book
-- whose status changes mid-day reflects the change in its message
-- without leaving the card itself inconsistent.

CREATE TABLE IF NOT EXISTS today_card_history (
  date       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_today_card_history_book_id ON today_card_history(book_id);
