-- Stories Layer 2: page ranges + per-story authors.
--
-- page_start / page_end carry where a story begins / ends in the parent
-- book. Either or both may be NULL (audiobook-only collections, or stories
-- the user hasn't bothered to range yet). When only page_start is set the
-- UI renders "p. 195"; when both, "p. 195–226".
--
-- story_authors mirrors book_authors: the join lives against the shared
-- authors table so a story-level author rendered on BookDetail (e.g. an
-- Edogawa Ranpo original adapted by Junji Ito) can be searched and sorted
-- alongside book authors. Rendering convention: if a story has no rows in
-- story_authors, fall back to the parent book's authors.

ALTER TABLE stories ADD COLUMN page_start INTEGER;
ALTER TABLE stories ADD COLUMN page_end   INTEGER;

CREATE TABLE IF NOT EXISTS story_authors (
  story_id  INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (story_id, author_id),
  FOREIGN KEY (story_id)  REFERENCES stories(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_story_authors_story_id  ON story_authors(story_id);
CREATE INDEX IF NOT EXISTS idx_story_authors_author_id ON story_authors(author_id);
