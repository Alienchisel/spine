import db from '../../db.js';

// Stats about the catalogue itself: most-used tags and biggest series.
export function getCatalogueStats() {
  const topTags = db.prepare(`
    SELECT t.name, COUNT(*) AS count
    FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    GROUP BY t.id
    ORDER BY count DESC
    LIMIT 15
  `).all();

  const topSeries = db.prepare(`
    SELECT series, COUNT(*) AS count
    FROM books
    WHERE series IS NOT NULL
    GROUP BY series
    HAVING count >= 2
    ORDER BY count DESC
    LIMIT 10
  `).all();

  return { topTags, topSeries };
}
