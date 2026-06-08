import express from 'express';
import db from '../db.js';
import { toCoverUrl } from '../lib/books/normalization.js';

const router = express.Router();

// Index of every series in the library with book_count + the
// publication-year and series-number ranges. Backs /series (the index
// page). Series are stored as a free-text column on books.series with
// no separate table — we just GROUP BY the column, matching how the
// Stats "Top series" section computes its top list. Empty / null
// series are excluded.
router.get('/', (req, res) => {
  // Showcase row — return only the up-to-5 series that occupy a slot,
  // ordered by rank, with the representative cover (the first volume's
  // cover_path; series_number ASC, then year_published ASC) inlined so
  // the client renders the row without a per-series cover lookup.
  // Orphaned rows (the last book in a series got deleted or re-tagged)
  // drop out via the EXISTS guard but stay on disk so a re-add restores
  // the prior pick.
  if (req.query.showcase === '1' || req.query.showcase === 'true') {
    const rows = db.prepare(`
      SELECT
        ss.series              AS name,
        ss.showcase_position   AS showcase_position,
        (SELECT COUNT(*)       FROM books b WHERE b.series = ss.series) AS book_count,
        (SELECT cover_path     FROM books b
           WHERE b.series = ss.series AND b.cover_path IS NOT NULL
           ORDER BY COALESCE(b.series_number, 9999) ASC, COALESCE(b.year_published, 9999) ASC
           LIMIT 1)                                                     AS cover_path
      FROM series_showcase ss
      WHERE EXISTS (SELECT 1 FROM books b WHERE b.series = ss.series)
      ORDER BY ss.showcase_position ASC
      LIMIT 5
    `).all();
    // Normalize cover_path to the served URL shape (same toCoverUrl every
    // other books-bearing endpoint uses) so the client renders the row
    // without an ad-hoc /uploads/ prefix.
    return res.json(rows.map(r => ({ ...r, cover_path: toCoverUrl(r.cover_path) })));
  }

  // Index path — every series, with showcase_position joined in so the
  // SeriesIndex page can render the ★ state without a second roundtrip.
  const rows = db.prepare(`
    SELECT
      b.series                AS name,
      COUNT(*)                AS book_count,
      MIN(b.series_number)    AS min_number,
      MAX(b.series_number)    AS max_number,
      MIN(b.year_published)   AS first_year,
      MAX(b.year_published)   AS last_year,
      ss.showcase_position    AS showcase_position
    FROM books b
    LEFT JOIN series_showcase ss ON ss.series = b.series
    WHERE b.series IS NOT NULL AND b.series != ''
    GROUP BY b.series
    ORDER BY b.series COLLATE NOCASE
  `).all();
  res.json(rows);
});

// PATCH /api/series/showcase — set or clear a series's showcase rank.
// Body: { series: "The Border Trilogy", showcase_position: 3 | null }.
// 1–5 inserts/replaces; null/empty deletes the row. Same 1–5 contract
// as the books and authors PATCH paths so a multi-section /showcase
// page reasons about ranks uniformly. Empty-series payloads or names
// that don't appear on any book are rejected loudly so a typo can't
// park a permanent orphan.
router.patch('/showcase', (req, res) => {
  const series = typeof req.body?.series === 'string' ? req.body.series.trim() : '';
  if (!series) return res.status(400).json({ error: 'series is required' });
  const exists = db.prepare('SELECT 1 FROM books WHERE series = ? LIMIT 1').get(series);
  if (!exists) return res.status(404).json({ error: 'No books carry that series' });
  const raw = req.body?.showcase_position;
  if (raw === null || raw === undefined || raw === '') {
    db.prepare('DELETE FROM series_showcase WHERE series = ?').run(series);
    return res.json({ series, showcase_position: null });
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return res.status(400).json({ error: 'showcase_position must be an integer 1–5' });
  }
  db.prepare('INSERT INTO series_showcase (series, showcase_position) VALUES (?, ?) ON CONFLICT(series) DO UPDATE SET showcase_position = excluded.showcase_position').run(series, n);
  res.json({ series, showcase_position: n });
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
