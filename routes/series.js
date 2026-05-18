import express from 'express';
import db from '../db.js';

const router = express.Router();

// Index of every series in the library with book_count + the
// publication-year and series-number ranges. Backs /series (the index
// page). Series are stored as a free-text column on books.series with
// no separate table — we just GROUP BY the column, matching how the
// Stats "Top series" section computes its top list. Empty / null
// series are excluded.
router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      series                AS name,
      COUNT(*)              AS book_count,
      MIN(series_number)    AS min_number,
      MAX(series_number)    AS max_number,
      MIN(year_published)   AS first_year,
      MAX(year_published)   AS last_year
    FROM books
    WHERE series IS NOT NULL AND series != ''
    GROUP BY series
    ORDER BY series COLLATE NOCASE
  `).all();
  res.json(rows);
});

export default router;
