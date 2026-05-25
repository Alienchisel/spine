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

// Per-book volume data for /data-viz's completion sparklines. One row
// per book with a series_number set; the client groups and renders.
router.get('/completion', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      series          AS name,
      series_number   AS position,
      owned,
      status,
      id,
      title
    FROM books
    WHERE series IS NOT NULL AND series != ''
      AND series_number IS NOT NULL
      AND COALESCE(archived, 0) = 0
    ORDER BY series COLLATE NOCASE, series_number
  `).all();
  res.json(rows);
});

export default router;
