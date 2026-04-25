ALTER TABLE list_books ADD COLUMN position INTEGER;

UPDATE list_books
SET position = (
  SELECT COUNT(*)
  FROM list_books lb2
  WHERE lb2.list_id = list_books.list_id
    AND lb2.rowid < list_books.rowid
);
