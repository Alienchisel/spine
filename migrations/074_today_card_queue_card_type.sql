-- Adds card_type to today_card_queue so the same queue table can hold
-- multiple AI-shaped card types. v0 (migration 073) implicitly hosted
-- 'connection' only; with 'reading_path' joining the rotation in
-- 1.222.0 we need to distinguish queue rows by type so cohort
-- selection picks the right unserved candidates.
--
-- Default 'connection' on existing rows so the six manually-seeded
-- Connection candidates from the 2026-06 chat batch land in the right
-- bucket without backfill.
--
-- Re-keys the unserved partial index by (card_type, id) so the hot
-- "next unserved candidate of type X" query stays a single seek.

ALTER TABLE today_card_queue
  ADD COLUMN card_type TEXT NOT NULL DEFAULT 'connection';

DROP INDEX IF EXISTS idx_today_card_queue_unserved;
CREATE INDEX IF NOT EXISTS idx_today_card_queue_unserved
  ON today_card_queue(card_type, id) WHERE served_at IS NULL;
