-- Add a separate "approximate" flag for year_published. The existing
-- year_approximate column has historically marked the EDITION year as
-- approximate (mapping.js gates the form checkbox on year_edition), but
-- for older works the more commonly-approximate year is the PUBLISHED
-- year (Seneca's letters ~65 CE, with an exact 2017 modern translation).
-- Splitting the two so they can be set independently.
ALTER TABLE books ADD COLUMN year_published_approximate INTEGER NOT NULL DEFAULT 0;
