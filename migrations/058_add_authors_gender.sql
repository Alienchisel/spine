-- Author gender, nullable. Three buckets cover the cases worth tracking
-- in a personal-reading-stats context; everything else stays NULL
-- ("unassigned") and surfaces as its own slice on the Stats page so
-- backfill never feels mandatory.
ALTER TABLE authors
  ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female', 'nonbinary'));
