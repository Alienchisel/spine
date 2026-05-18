-- Promote author birth/death from year-only integers to TEXT date strings
-- so we can store month/day precision when OL has it (and later do things
-- like "today's authors with birthdays" if we want). Format is:
--   "YYYY"           — year only (most common)
--   "YYYY-MM"        — year + month
--   "YYYY-MM-DD"     — full date
--   "-NNN[N][-MM-DD]"— BCE years use a leading minus (e.g. "-428" = Plato)
-- The PATCH validator enforces the shape on writes.
--
-- Backfill copies the existing integer year directly into TEXT, so all
-- existing rows become year-only strings. The new columns are added,
-- backfilled, then the old INTEGER columns are dropped (SQLite ≥ 3.35
-- supports ALTER TABLE DROP COLUMN, so no table rebuild needed —
-- foreign-key cascade gotcha avoided).

ALTER TABLE authors ADD COLUMN birth_date TEXT;
ALTER TABLE authors ADD COLUMN death_date TEXT;

UPDATE authors SET birth_date = CAST(birth_year AS TEXT) WHERE birth_year IS NOT NULL;
UPDATE authors SET death_date = CAST(death_year AS TEXT) WHERE death_year IS NOT NULL;

ALTER TABLE authors DROP COLUMN birth_year;
ALTER TABLE authors DROP COLUMN death_year;
