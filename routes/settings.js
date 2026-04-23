import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === null || value === undefined) return res.status(400).json({ error: 'value required' });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  res.json({ key, value: String(value) });
});

export default router;
