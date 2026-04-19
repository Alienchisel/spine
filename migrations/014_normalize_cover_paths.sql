UPDATE books SET cover_path = REPLACE(cover_path, '/uploads/', '') WHERE cover_path LIKE '/uploads/%';
