-- One-shot backfill: convert UTC timestamps to local time on existing rows.
-- All writers now use datetime('now', 'localtime'); this fixes the historical
-- rows stored before that change. SQLite's 'localtime' modifier interprets
-- the input as UTC and converts using the historical TZ rules at that date,
-- so DST transitions are handled correctly.
--
-- reading_log.date is intentionally excluded: it stores YYYY-MM-DD only,
-- so the original time-of-day (and therefore the correct local date) cannot
-- be recovered. A handful of late-evening entries may be off by one day.

UPDATE books SET
  created_at = datetime(created_at, 'localtime'),
  updated_at = datetime(updated_at, 'localtime');

UPDATE reads SET
  created_at = datetime(created_at, 'localtime')
WHERE created_at IS NOT NULL;

UPDATE lists SET
  created_at = datetime(created_at, 'localtime'),
  updated_at = datetime(updated_at, 'localtime');

UPDATE list_books SET
  added_at = datetime(added_at, 'localtime');
