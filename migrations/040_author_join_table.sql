CREATE TABLE authors (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE book_authors (
  book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, author_id)
);

-- Migrate existing single-author values
INSERT INTO authors (name)
SELECT DISTINCT TRIM(author)
FROM books
WHERE author IS NOT NULL AND TRIM(author) != '';

INSERT INTO book_authors (book_id, author_id, position)
SELECT b.id, a.id, 0
FROM books b
JOIN authors a ON a.name = TRIM(b.author)
WHERE b.author IS NOT NULL AND TRIM(b.author) != '';

ALTER TABLE books DROP COLUMN author;
