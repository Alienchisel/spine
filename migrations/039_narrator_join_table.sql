CREATE TABLE narrators (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE book_narrators (
  book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  narrator_id INTEGER NOT NULL REFERENCES narrators(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, narrator_id)
);

-- Migrate existing single-narrator values
INSERT INTO narrators (name)
SELECT DISTINCT TRIM(narrator)
FROM books
WHERE narrator IS NOT NULL AND TRIM(narrator) != '';

INSERT INTO book_narrators (book_id, narrator_id, position)
SELECT b.id, n.id, 0
FROM books b
JOIN narrators n ON n.name = TRIM(b.narrator)
WHERE b.narrator IS NOT NULL AND TRIM(b.narrator) != '';

ALTER TABLE books DROP COLUMN narrator;
