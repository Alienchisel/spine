-- Per-attempt DNF flag on reads rows. A book's `status` (reading / finished /
-- unread) describes the current relationship; `reads.did_not_finish` records
-- that a specific attempt was abandoned. Lets one book carry both an
-- abandoned 2024 attempt and a finished 2026 re-read without conflict.
ALTER TABLE reads ADD COLUMN did_not_finish INTEGER NOT NULL DEFAULT 0;
