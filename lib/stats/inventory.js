import db from '../../db.js';

// Counts and groupings over the books table. None of these depend on
// reading_log activity — they describe the shape of the catalogue at rest.
export function getInventoryStats() {
  // "Owned" everywhere on this page means "owned media" — i.e. excludes
  // custom books (personal works/notes). Mirrors the Library Owned tab and
  // the /api/books/counts.owned counter so Stats and Library never disagree.
  const totals = db.prepare(`
    SELECT
      COUNT(*)                          AS books,
      SUM(owned = 1 AND COALESCE(is_custom,0) = 0) AS owned,
      SUM(previously_owned = 1)         AS previously_owned,
      SUM(status = 'reading')           AS reading,
      SUM(status = 'finished')          AS finished,
      SUM(status = 'unread')            AS unread,
      SUM(loved = 1)                    AS loved
    FROM books
  `).get();

  const formats = db.prepare(`
    SELECT format, COUNT(*) AS count FROM books
    WHERE owned = 1 AND COALESCE(is_custom,0) = 0
    GROUP BY format ORDER BY count DESC
  `).all();

  const fiction = db.prepare(`
    SELECT
      SUM(fiction = 1)     AS fiction,
      SUM(fiction = 0)     AS nonfiction,
      SUM(fiction IS NULL) AS unset
    FROM books WHERE owned = 1 AND COALESCE(is_custom,0) = 0
  `).get();

  const ownedStatus = db.prepare(`
    SELECT
      SUM(status = 'reading')  AS reading,
      SUM(status = 'finished') AS finished,
      SUM(status = 'unread')   AS unread
    FROM books WHERE owned = 1 AND COALESCE(is_custom,0) = 0
  `).get();

  const ratings = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM books WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating DESC
  `).all();

  return { totals, formats, fiction, ownedStatus, ratings };
}
