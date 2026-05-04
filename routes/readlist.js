import express from 'express';
import db from '../db.js';
import { toCoverUrl } from '../lib/books/normalization.js';
import { attachBookCardJoinedFields } from '../lib/books/joinedFields.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT * FROM books WHERE on_readlist = 1
    ORDER BY readlist_position ASC, id ASC
  `).all();
  if (!rows.length) return res.json([]);
  const books = attachBookCardJoinedFields(rows).map(b => ({
    ...b,
    cover_path: toCoverUrl(b.cover_path),
  }));
  res.json(books);
});

router.put('/order', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.some(id => !Number.isInteger(Number(id)))) {
    return res.status(400).json({ error: 'ids must be an array of integers' });
  }
  const update = db.prepare('UPDATE books SET readlist_position = ? WHERE id = ? AND on_readlist = 1');
  db.transaction(() => {
    ids.forEach((id, i) => update.run(i, Number(id)));
  })();
  res.json({ ok: true });
});

export default router;
