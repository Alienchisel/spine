ALTER TABLE books ADD COLUMN read_count INTEGER NOT NULL DEFAULT 0;
UPDATE books SET read_count = 1 WHERE status = 'finished';
