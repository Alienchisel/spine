import express from 'express';
import { computeAllStats } from '../lib/stats/index.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(computeAllStats());
});

export default router;
