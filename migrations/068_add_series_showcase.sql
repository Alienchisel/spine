-- Series isn't a first-class entity in Spine — books.series is a free-text
-- column grouped by GROUP BY at query time. The showcase membership stores
-- the rank by series name on the side; orphaned rows (after the last book
-- in a series is deleted or re-categorized) are filtered at query time via
-- EXISTS rather than cascade-cleaned, since rejoining a series later
-- should restore the prior pick.
CREATE TABLE IF NOT EXISTS series_showcase (
  series            TEXT    PRIMARY KEY,
  showcase_position INTEGER NOT NULL CHECK (showcase_position BETWEEN 1 AND 5)
);
