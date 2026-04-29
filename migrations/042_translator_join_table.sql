CREATE TABLE translators (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE book_translators (
  book_id       INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  translator_id INTEGER NOT NULL REFERENCES translators(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, translator_id)
);

-- Migrate existing single-translator values verbatim. Multi-translator
-- strings (e.g. "George Long, revised by Duncan Steen") become one row;
-- those are easier to clean up via the new chip UI than to risk a regex split.
INSERT INTO translators (name)
SELECT DISTINCT TRIM(translator)
FROM books
WHERE translator IS NOT NULL AND TRIM(translator) != '';

INSERT INTO book_translators (book_id, translator_id, position)
SELECT b.id, t.id, 0
FROM books b
JOIN translators t ON t.name = TRIM(b.translator)
WHERE b.translator IS NOT NULL AND TRIM(b.translator) != '';

ALTER TABLE books DROP COLUMN translator;
