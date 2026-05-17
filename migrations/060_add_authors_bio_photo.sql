-- Author bio + portrait fetched lazily from Open Library on first visit
-- to /authors/:id. All nullable: a fresh author starts with everything
-- null until the auto-refresh effect runs; if OL has no match, fields
-- stay null and the page falls back to a clean skeleton.
ALTER TABLE authors ADD COLUMN bio            TEXT;
ALTER TABLE authors ADD COLUMN birth_year     INTEGER;
ALTER TABLE authors ADD COLUMN death_year     INTEGER;
ALTER TABLE authors ADD COLUMN photo_path     TEXT;
ALTER TABLE authors ADD COLUMN ol_key         TEXT;
ALTER TABLE authors ADD COLUMN bio_fetched_at TEXT;
