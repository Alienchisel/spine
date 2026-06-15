import express from 'express';
import { computeAllStats } from '../lib/stats/index.js';
import { getReadingCalendar, getLibraryTrajectory } from '../lib/stats/activity.js';
import { getAudit } from '../lib/stats/audit.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(computeAllStats());
});

// Dedicated calendar feed for /data-viz. Returns one row per distinct
// reading-log date with summed pages and minutes. Kept off the main
// stats payload to avoid sending ~1500+ rows to every Stats page load.
router.get('/reading-calendar', (_req, res) => {
  res.json(getReadingCalendar());
});

// Monthly cumulative acquired vs finished — the "to-read mountain"
// trajectory feed for /data-viz.
router.get('/library-trajectory', (_req, res) => {
  res.json(getLibraryTrajectory());
});

// Audit feed for the /audit page. Heavyweight — runs ~40 SUM(CASE)
// expressions across the books table — and only the Audit page reads
// it, so it's kept off the main /api/stats payload that Stats hits on
// every navigation.
router.get('/audit', (_req, res) => {
  res.json(getAudit());
});

export default router;
