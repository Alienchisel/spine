import express from 'express';
import db, { nrm } from '../db.js';
import { toCoverUrl } from '../lib/books/normalization.js';

const router = express.Router();

// Index of every series in the library with book_count + the
// publication-year and series-number ranges. Backs /series (the index
// page). Series are stored as a free-text column on books.series with
// no separate table — we just GROUP BY the column, matching how the
// Stats "Top series" section computes its top list. Empty / null
// series are excluded.
router.get('/', (req, res) => {
  // Loved row — every series the user has hearted. Returns the canonical
  // first-volume cover as the representative image so the /loved page
  // renders the row without per-series lookups. Orphaned rows (last
  // book in a series got deleted) drop via the EXISTS guard but stay on
  // disk so a re-add restores the prior love.
  if (req.query.loved === '1' || req.query.loved === 'true') {
    const rows = db.prepare(`
      SELECT
        sl.series              AS name,
        1                      AS loved,
        (SELECT COUNT(*)       FROM books b WHERE b.series = sl.series) AS book_count,
        (SELECT cover_path     FROM books b
           WHERE b.series = sl.series AND b.cover_path IS NOT NULL
           ORDER BY COALESCE(b.series_number, 9999) ASC, COALESCE(b.year_published, 9999) ASC
           LIMIT 1)                                                     AS cover_path
      FROM series_loved sl
      WHERE EXISTS (SELECT 1 FROM books b WHERE b.series = sl.series)
      ORDER BY nrm(sl.series)
    `).all();
    return res.json(rows.map(r => ({ ...r, cover_path: toCoverUrl(r.cover_path) })));
  }

  // Index path — every series, with loved joined in so the SeriesIndex
  // page renders the heart state without a second roundtrip.
  const rows = db.prepare(`
    SELECT
      b.series                          AS name,
      COUNT(*)                          AS book_count,
      MIN(b.series_number)              AS min_number,
      MAX(b.series_number)              AS max_number,
      MIN(b.year_published)             AS first_year,
      MAX(b.year_published)             AS last_year,
      (sl.series IS NOT NULL)           AS loved
    FROM books b
    LEFT JOIN series_loved sl ON sl.series = b.series
    WHERE b.series IS NOT NULL AND b.series != ''
    GROUP BY b.series
    ORDER BY nrm(b.series)
  `).all();
  res.json(rows);
});

// PATCH /api/series/loved — toggle a series's loved state. Body:
// { series: "The Border Trilogy", loved: true | false }. true inserts;
// false deletes. Empty series payloads or names that don't appear on
// any book are rejected loudly so a typo on the client can't park a
// permanent orphan.
router.patch('/loved', (req, res) => {
  const series = typeof req.body?.series === 'string' ? req.body.series.trim() : '';
  if (!series) return res.status(400).json({ error: 'series is required' });
  const exists = db.prepare('SELECT 1 FROM books WHERE series = ? LIMIT 1').get(series);
  if (!exists) return res.status(404).json({ error: 'No books carry that series' });
  if (req.body?.loved) {
    db.prepare('INSERT OR IGNORE INTO series_loved (series) VALUES (?)').run(series);
    return res.json({ series, loved: true });
  }
  db.prepare('DELETE FROM series_loved WHERE series = ?').run(series);
  res.json({ series, loved: false });
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
    ORDER BY nrm(series), series_number, nrm(title), id
  `).all();
  res.json(rows);
});

export default router;
