-- Pen-name / alias linking: authors sharing a non-NULL alias_group_id are
-- the same person writing under different bylines (Bronze Age Pervert ↔
-- Costin Alamariu, Mencius Moldbug ↔ Curtis Yarvin, etc). NULL means the
-- author isn't part of any group. Pattern mirrors `work_id` on books —
-- symmetric membership, no canonical/primary, dissolves automatically
-- when a group drops to one member.
ALTER TABLE authors ADD COLUMN alias_group_id INTEGER;
CREATE INDEX idx_authors_alias_group ON authors(alias_group_id) WHERE alias_group_id IS NOT NULL;
