import express from 'express';
import { computeCollage, ALLOWED_MODES, ALLOWED_PERIODS } from '../lib/stats/collage.js';

const router = express.Router();

// Grid-collage data for /collage. Three knobs the client passes via
// query string: mode (what's being ranked), period (over what window),
// size (grid edge — 2..5, so 4..25 tiles). Validates each before
// touching the DB so bad input is a clean 400 instead of a 500.
router.get('/', (req, res) => {
  const mode   = String(req.query.mode   || 'top_books');
  const period = String(req.query.period || '30d');
  const size   = Math.max(2, Math.min(5, parseInt(req.query.size, 10) || 3));
  if (!ALLOWED_MODES.includes(mode))     return res.status(400).json({ error: `Invalid mode: ${mode}` });
  if (!ALLOWED_PERIODS.includes(period)) return res.status(400).json({ error: `Invalid period: ${period}` });
  try {
    res.json(computeCollage({ mode, period, size }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute collage', detail: String(err.message || err) });
  }
});

export default router;
