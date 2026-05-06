-- Cross-edition linking: books sharing a non-NULL work_id are alternate
-- editions of the same underlying work (different format, translation,
-- printing, etc). NULL means the book is not part of any group. The
-- index makes "fetch siblings of book X" cheap on detail-page loads.
ALTER TABLE books ADD COLUMN work_id INTEGER;
CREATE INDEX idx_books_work_id ON books(work_id) WHERE work_id IS NOT NULL;
