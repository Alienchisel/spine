-- Series isn't a first-class entity (books.series is a free-text column
-- grouped at query time), so love-marks live in a side table keyed by
-- name. Orphaned rows (last book in a series deleted or re-tagged) drop
-- from the loved view via EXISTS but stay on disk so a re-add restores
-- the prior love.
CREATE TABLE IF NOT EXISTS series_loved (
  series TEXT PRIMARY KEY
);
