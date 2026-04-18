PRAGMA foreign_keys=OFF;

CREATE TABLE books_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    status TEXT DEFAULT 'unread' CHECK(status IN ('reading', 'paused', 'finished', 'unread')),
    owned INTEGER NOT NULL DEFAULT 0,
    cover_path TEXT,
    rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),
    date_started TEXT,
    date_finished TEXT,
    acquisition_source TEXT,
    format TEXT CHECK(format IS NULL OR format IN ('physical', 'ebook', 'audiobook')),
    binding TEXT CHECK(binding IS NULL OR binding IN ('paperback', 'hardcover')),
    condition TEXT CHECK(condition IS NULL OR condition IN ('new', 'fine', 'very good', 'good', 'fair', 'poor')),
    description TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    page_count INTEGER,
    duration_minutes INTEGER,
    publisher TEXT,
    series TEXT,
    current_page INTEGER,
    acquisition_date TEXT,
    isbn_10 TEXT,
    isbn_13 TEXT,
    shelf_room TEXT,
    shelf_unit TEXT,
    shelf_number INTEGER,
    is_custom INTEGER NOT NULL DEFAULT 0
);

INSERT INTO books_new
    SELECT id, title, author, status, owned, cover_path, rating,
           date_started, date_finished, acquisition_source, format, binding,
           CASE condition WHEN 'used' THEN 'good' ELSE condition END,
           description, notes, created_at, updated_at,
           page_count, duration_minutes, publisher, series, current_page,
           acquisition_date, isbn_10, isbn_13, shelf_room, shelf_unit, shelf_number, is_custom
    FROM books;

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

PRAGMA foreign_keys=ON;
