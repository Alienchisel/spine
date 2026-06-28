-- Composite index supporting the reads-as-source-of-truth Phase 2
-- subqueries. Every Library sort by date_finished / date_started, every
-- stats date-bucketing query, and every personal_anniversary lookup
-- runs a per-book (SELECT MAX(date_finished) FROM reads WHERE book_id=?)
-- against the reads table. Without an index this is a linear scan over
-- the whole reads table for every book — manageable today (287 rows)
-- but it becomes O(books × reads) once libraries grow, and Phase 2
-- ships at exactly the point where the subquery count goes from 1
-- (the GROUP BY in attachReadAggregates) to one-per-sort-row.
--
-- The leading column is book_id (every query filters by it). date_finished
-- second supports the MAX() lookup as a covered-index scan (SQLite picks
-- the rightmost index entry per book_id without visiting reads rows).
-- date_started isn't included in this index — that aggregate is rarer
-- and adding a third column doubles the index size for marginal gain.
CREATE INDEX IF NOT EXISTS idx_reads_book_id_date_finished
  ON reads(book_id, date_finished);
