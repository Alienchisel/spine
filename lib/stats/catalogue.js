import db from '../../db.js';

// Stats about the catalogue itself: most-used tags and biggest series.
export function getCatalogueStats() {
  const topTags = db.prepare(`
    SELECT t.name, COUNT(*) AS count
    FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC
    LIMIT 15
  `).all();

  const topSeries = db.prepare(`
    SELECT series, COUNT(*) AS count
    FROM books
    WHERE series IS NOT NULL AND series != ''
    GROUP BY series
    HAVING count >= 2
    ORDER BY count DESC, series ASC
    LIMIT 10
  `).all();

  // Histogram of original year_published bucketed into decades. The CASE
  // floors toward -∞ so BCE works are bucketed correctly (SQLite integer
  // division truncates toward zero, which would put -451 in the -450s).
  // read = books in that decade with read_count > 0; used by
  // /data-viz's published-spectrum overlay to show how the library's
  // temporal coverage compares to what's actually been read.
  const decadesPublished = db.prepare(`
    SELECT
      CASE
        WHEN year_published >= 0 THEN (year_published / 10) * 10
        ELSE ((year_published - 9) / 10) * 10
      END AS decade,
      COUNT(*)              AS count,
      SUM(read_count > 0)   AS read
    FROM books
    WHERE year_published IS NOT NULL
    GROUP BY decade
    ORDER BY decade ASC
  `).all();

  return { topTags, topSeries, decadesPublished };
}
