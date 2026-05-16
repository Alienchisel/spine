-- Relax the books.binding CHECK to allow a third value 'other'. The
-- existing two ('paperback', 'hardcover') don't cover flex / limp /
-- leatherbound / spiral / board-book / etc. bindings; rather than
-- enumerating every variant 'other' catches the long tail and the
-- user can clarify in notes.
--
-- SQLite can't ALTER a CHECK constraint in place; the only path is the
-- table-rebuild pattern (mirrors migration 053). PRAGMA foreign_keys
-- OFF so the DROP doesn't cascade through the FK references on
-- shelves / buildings / rooms / units.

PRAGMA foreign_keys = OFF;

CREATE TABLE books_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'unread' CHECK(status IN ('reading', 'paused', 'finished', 'unread')),
    owned INTEGER NOT NULL DEFAULT 0,
    cover_path TEXT,
    rating REAL CHECK(rating IS NULL OR (rating >= 0.5 AND rating <= 5)),
    date_started TEXT,
    date_finished TEXT,
    acquisition_source TEXT,
    format TEXT CHECK(format IS NULL OR format IN ('physical', 'ebook', 'audiobook')),
    binding TEXT CHECK(binding IS NULL OR binding IN ('paperback', 'hardcover', 'other')),
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
    is_custom INTEGER NOT NULL DEFAULT 0,
    current_minutes INTEGER,
    year_published INTEGER,
    year_edition INTEGER,
    series_number REAL,
    loved INTEGER NOT NULL DEFAULT 0,
    on_readlist INTEGER NOT NULL DEFAULT 0,
    readlist_position INTEGER,
    is_stub INTEGER NOT NULL DEFAULT 0,
    fiction INTEGER,
    source_type TEXT,
    asin TEXT,
    review TEXT,
    read_count INTEGER NOT NULL DEFAULT 0,
    language TEXT NOT NULL DEFAULT 'English',
    original_language TEXT,
    previously_owned INTEGER NOT NULL DEFAULT 0,
    shelf_id INTEGER REFERENCES shelves(id) ON DELETE SET NULL,
    building_id INTEGER REFERENCES buildings(id) ON DELETE SET NULL,
    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
    shelf_position INTEGER,
    year_approximate INTEGER NOT NULL DEFAULT 0,
    abridged INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    work_id INTEGER,
    desire_rank INTEGER,
    year_published_approximate INTEGER NOT NULL DEFAULT 0
);

INSERT INTO books_new
  SELECT id, title, status, owned, cover_path, rating, date_started, date_finished,
         acquisition_source, format, binding, condition, description, notes,
         created_at, updated_at, page_count, duration_minutes, publisher, series,
         current_page, acquisition_date, isbn_10, isbn_13, is_custom, current_minutes,
         year_published, year_edition, series_number, loved, on_readlist,
         readlist_position, is_stub, fiction, source_type, asin, review, read_count,
         language, original_language, previously_owned, shelf_id, building_id,
         room_id, unit_id, shelf_position, year_approximate, abridged, archived,
         work_id, desire_rank, year_published_approximate
    FROM books;

-- Preserve the AUTOINCREMENT counter so freshly-inserted books don't
-- collide with ids of recently-deleted rows from before the rebuild.
INSERT OR REPLACE INTO sqlite_sequence (name, seq)
  SELECT 'books', seq FROM sqlite_sequence WHERE name = 'books';

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

CREATE INDEX idx_books_work_id ON books(work_id) WHERE work_id IS NOT NULL;

PRAGMA foreign_keys = ON;
