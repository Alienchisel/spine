import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const books = db.prepare(`
    SELECT * FROM books WHERE on_readlist = 1
    ORDER BY readlist_position ASC, id ASC
  `).all();
  const withTags = books.map(b => {
    const tags = db.prepare(`
      SELECT t.id, t.name FROM tags t
      JOIN book_tags bt ON bt.tag_id = t.id
      WHERE bt.book_id = ?
    `).all(b.id);
    const cover_path = b.cover_path ? `/uploads/${b.cover_path}` : null;
    return { ...b, cover_path, tags };
  });
  res.json(withTags);
});

router.put('/order', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.some(id => !Number.isInteger(Number(id)))) {
    return res.status(400).json({ error: 'ids must be an array of integers' });
  }
  const update = db.prepare('UPDATE books SET readlist_position = ? WHERE id = ?');
  db.transaction(() => {
    ids.forEach((id, i) => update.run(i, Number(id)));
  })();
  res.json({ ok: true });
});

export default router;
