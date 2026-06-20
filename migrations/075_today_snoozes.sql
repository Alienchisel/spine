-- Today-card snoozes — per-book "don't surface me again until N" entries
-- consumed by lib/today/card.js pickTodayCard. The existing 14-day
-- repetition guard already covers same-book showings; snoozes extend
-- that to a user-chosen window, capped by the snoozed_until date.
--
-- INSERT OR REPLACE on book_id PK keeps the latest snooze winning if
-- the user re-snoozes a still-snoozed book — a fresh 7 days from the
-- new click rather than appending. snoozed_at is a debugging breadcrumb;
-- the cohort filter only reads snoozed_until.

CREATE TABLE today_snoozes (
  book_id       INTEGER PRIMARY KEY,
  snoozed_until DATE     NOT NULL,
  snoozed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX idx_today_snoozes_until ON today_snoozes(snoozed_until);
