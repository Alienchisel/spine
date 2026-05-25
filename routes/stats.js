import express from 'express';
import { computeAllStats } from '../lib/stats/index.js';
import { getReadingCalendar, getLibraryTrajectory, getTagDecadeMatrix } from '../lib/stats/activity.js';

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

// Tag × decade matrix for /data-viz's heatmap. Flat (tag, decade, count)
// rows; client pivots into the grid.
router.get('/tag-decade-matrix', (_req, res) => {
  res.json(getTagDecadeMatrix());
});

export default router;
