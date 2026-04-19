import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT rl.id, rl.book_id, rl.date, rl.pages_read, rl.minutes_read,
           b.title, b.author, b.cover_path, b.format
    FROM reading_log rl
    JOIN books b ON b.id = rl.book_id
    ORDER BY rl.date DESC, b.title ASC
  `).all();

  const byDate = {};
  for (const row of rows) {
    if (!byDate[row.date]) byDate[row.date] = [];
    byDate[row.date].push({
      id:           row.id,
      book_id:      row.book_id,
      title:        row.title,
      author:       row.author,
      cover_path:   row.cover_path ? `/uploads/${row.cover_path}` : null,
      format:       row.format,
      pages_read:   row.pages_read,
      minutes_read: row.minutes_read,
    });
  }

  res.json(Object.entries(byDate).map(([date, entries]) => ({ date, entries })));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const entry = db.prepare('SELECT id FROM reading_log WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM reading_log WHERE id = ?').run(id);
  res.status(204).end();
});

export default router;
