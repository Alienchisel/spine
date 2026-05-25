import express from 'express';
import { computeAllStats } from '../lib/stats/index.js';
import { getReadingCalendar } from '../lib/stats/activity.js';

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

export default router;
