-- Replace 'nonbinary' with 'other' in the authors.gender CHECK. 'other'
-- spans the cases nonbinary alone couldn't carry — mixed-gender pen
-- names (Lewis Padgett), collectives (Ccru, TSR), institutional bylines
-- (Roman Catholic Church, NYT), and pseudonyms of unknowable identity
-- (Satoshi Nakamoto) — while still leaving NULL ("unassigned") as the
-- "haven't tagged yet" to-do bucket.
--
-- SQLite can't ALTER a CHECK constraint in place; the only path is the
-- table-rebuild pattern (mirrors migration 057). PRAGMA foreign_keys
-- OFF so the DROP doesn't cascade through book_authors / story_authors.
-- No data migration needed — the nonbinary bucket was empty.

PRAGMA foreign_keys = OFF;

CREATE TABLE authors_new (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  alias_group_id INTEGER,
  gender         TEXT CHECK (gender IN ('male', 'female', 'other'))
);

INSERT INTO authors_new (id, name, alias_group_id, gender)
  SELECT id, name, alias_group_id, gender FROM authors;

DROP TABLE authors;
ALTER TABLE authors_new RENAME TO authors;

CREATE INDEX idx_authors_alias_group ON authors(alias_group_id) WHERE alias_group_id IS NOT NULL;

PRAGMA foreign_keys = ON;
