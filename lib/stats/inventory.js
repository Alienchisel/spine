import db from '../../db.js';

// Counts and groupings over the books table. None of these depend on
// reading_log activity — they describe the shape of the catalogue at rest.
export function getInventoryStats() {
  // "Owned" everywhere on this page means "purchased media" — excludes
  // custom (personal works) and Internet-sourced (free downloads). Mirrors
  // the Library Owned tab and /api/books/counts.owned so Stats and Library
  // never disagree. Without the Internet exclusion a few hundred free
  // manga downloads would dwarf the count and skew every breakdown below.
  const ownedFilter = "owned = 1 AND COALESCE(is_custom,0) = 0 AND COALESCE(acquisition_source,'') != 'Internet'";
  const totals = db.prepare(`
    SELECT
      COUNT(*)                          AS books,
      SUM(${ownedFilter})               AS owned,
      SUM(previously_owned = 1)         AS previously_owned,
      SUM(owned = 0
          AND COALESCE(previously_owned,0) = 0
          AND COALESCE(is_custom,0) = 0
          AND COALESCE(archived,0) = 0)  AS never_owned,
      SUM(status = 'reading')           AS reading,
      SUM(status = 'finished')          AS finished,
      SUM(status = 'unread')            AS unread,
      SUM(loved = 1)                    AS loved
    FROM books
  `).get();

  const formats = db.prepare(`
    SELECT format, COUNT(*) AS count FROM books
    WHERE ${ownedFilter}
    GROUP BY format ORDER BY count DESC
  `).all();

  const fiction = db.prepare(`
    SELECT
      SUM(fiction = 1)     AS fiction,
      SUM(fiction = 0)     AS nonfiction,
      SUM(fiction IS NULL) AS unset
    FROM books WHERE ${ownedFilter}
  `).get();

  const ownedStatus = db.prepare(`
    SELECT
      SUM(status = 'reading')  AS reading,
      SUM(status = 'finished') AS finished,
      SUM(status = 'unread')   AS unread
    FROM books WHERE ${ownedFilter}
  `).get();

  const ratings = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM books WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating DESC
  `).all();

  // Acquisition source breakdown over books currently in the library
  // (owned=1, archived excluded). Bucketed into a small fixed taxonomy so
  // the donut stays readable: Kindle / Audible / Internet are digital
  // distribution lanes; everything else (AbeBooks, Chapters, Gift, etc.)
  // collapses into Physical; NULL/empty into Unknown. Includes
  // Internet-sourced rows even though Owned counts above exclude them —
  // this chart's purpose is "where does my library come from", which is
  // the one place that distinction is the actual subject.
  const acquisitionSources = db.prepare(`
    SELECT
      SUM(acquisition_source = 'Kindle')                                                      AS kindle,
      SUM(acquisition_source = 'Audible')                                                     AS audible,
      SUM(acquisition_source = 'Internet')                                                    AS internet,
      SUM(acquisition_source IS NOT NULL AND acquisition_source != ''
          AND acquisition_source NOT IN ('Kindle','Audible','Internet'))                      AS physical,
      SUM(acquisition_source IS NULL OR acquisition_source = '')                              AS unknown
    FROM books
    WHERE owned = 1 AND COALESCE(archived,0) = 0
  `).get();

  return { totals, formats, fiction, ownedStatus, ratings, acquisitionSources };
}
