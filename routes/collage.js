import express from 'express';
import { computeCollage, getCollageFacets, ALLOWED_MODES, ALLOWED_PERIODS } from '../lib/stats/collage.js';

const router = express.Router();

// Grid-collage data for /collage. Knobs the client passes via query
// string:
//   mode    — what's being ranked
//   period  — over what window (top_books / top_authors)
//   size    — grid edge, 3..6 (9..36 tiles)
//   year    — required when mode=year_in_review (YYYY)
// All inputs validated before touching the DB so bad input is a
// clean 400 instead of a generic 500.
router.get('/', (req, res) => {
  const mode   = String(req.query.mode   || 'top_books');
  const period = String(req.query.period || '30d');
  const size   = Math.max(3, Math.min(6, parseInt(req.query.size, 10) || 3));
  if (!ALLOWED_MODES.includes(mode))     return res.status(400).json({ error: `Invalid mode: ${mode}` });
  if (!ALLOWED_PERIODS.includes(period)) return res.status(400).json({ error: `Invalid period: ${period}` });

  let year = null;
  if (mode === 'year_in_review') {
    const raw = parseInt(req.query.year, 10);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(raw) || raw < 1900 || raw > currentYear + 1) {
      return res.status(400).json({ error: 'year must be between 1900 and next year' });
    }
    year = raw;
  }

  try {
    res.json(computeCollage({ mode, period, size, year }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute collage', detail: String(err.message || err) });
  }
});

// Picker data for the client. Only includes series that have at
// least one book and years that have at least one reading-log entry —
// the UI's series / year dropdowns aren't useful unless populated
// from real data.
router.get('/facets', (_req, res) => {
  res.json(getCollageFacets());
});

export default router;
