-- Performance indexes for hot query paths. Spine has only 7 user-defined
-- indexes pre-this; the FilterPanel facet counts, the Audit page's 30+
-- gap/population queries, and SeriesIndex's GROUP BY all hit full-table
-- scans on the 1900-row books table.
--
-- Partial WHERE clauses (loved, owned, archived) shrink the index size
-- where one value dominates (most books aren't loved; most owned books
-- aren't archived). The query planner picks the partial index only when
-- the SQL's predicate matches the partial's WHERE; Spine's filters use
-- the same shapes consistently.
--
-- Reverse-direction junction indexes (book_authors.author_id and
-- book_tags.tag_id) cover the "books by this author / tag" queries that
-- the PRIMARY KEY (book_id, x_id) can't satisfy directly.

-- Books — single-column filter columns.
CREATE INDEX IF NOT EXISTS idx_books_status             ON books(status);
CREATE INDEX IF NOT EXISTS idx_books_format             ON books(format);
CREATE INDEX IF NOT EXISTS idx_books_year_published     ON books(year_published);
CREATE INDEX IF NOT EXISTS idx_books_series             ON books(series);
CREATE INDEX IF NOT EXISTS idx_books_publisher          ON books(publisher);
CREATE INDEX IF NOT EXISTS idx_books_acquisition_date   ON books(acquisition_date);
CREATE INDEX IF NOT EXISTS idx_books_date_finished      ON books(date_finished);

-- Books — partial indexes where one value dominates and the predicate
-- shape is consistent across query sites.
CREATE INDEX IF NOT EXISTS idx_books_loved              ON books(loved)    WHERE loved = 1;
CREATE INDEX IF NOT EXISTS idx_books_archived           ON books(archived) WHERE archived = 1;
CREATE INDEX IF NOT EXISTS idx_books_owned              ON books(owned)    WHERE owned = 1;

-- Junction tables — reverse direction (the PRIMARY KEY only covers the
-- (book_id-first) ordering, so "books by author X" and "books with tag X"
-- otherwise scan the entire junction table).
CREATE INDEX IF NOT EXISTS idx_book_authors_author_id   ON book_authors(author_id);
CREATE INDEX IF NOT EXISTS idx_book_tags_tag_id         ON book_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_list_books_book_id       ON list_books(book_id);

-- Update planner statistics so the new indexes are used.
ANALYZE;
