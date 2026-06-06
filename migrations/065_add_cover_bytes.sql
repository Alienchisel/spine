-- System-managed column carrying the file size (bytes) of the cover
-- referenced by cover_path. Maintained on every write to cover_path by
-- repository.js; back-filled at server startup for any cover_path that
-- existed before this migration. Powers the missing=hi_res_cover filter
-- (under ~40KB → 'replace with a better image') and the corresponding
-- audit-page row. Pure SQL — backfill happens in code (db.js) since the
-- migration runner can't fs.statSync.

ALTER TABLE books ADD COLUMN cover_bytes INTEGER;
