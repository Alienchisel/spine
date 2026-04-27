import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const books = db.prepare(`
    SELECT * FROM books WHERE on_readlist = 1
    ORDER BY readlist_position ASC, id ASC
  `).all();
  if (!books.length) return res.json([]);
  const ids = books.map(b => b.id);
  const tagRows = db.prepare(`
    SELECT bt.book_id, t.id, t.name FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    WHERE bt.book_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids);
  const tagMap = new Map();
  for (const row of tagRows) {
    if (!tagMap.has(row.book_id)) tagMap.set(row.book_id, []);
    tagMap.get(row.book_id).push({ id: row.id, name: row.name });
  }
  const authorRows = db.prepare(`
    SELECT ba.book_id, a.id, a.name FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    WHERE ba.book_id IN (${ids.map(() => '?').join(',')})
    ORDER BY ba.position
  `).all(...ids);
  const authorMap = new Map();
  for (const row of authorRows) {
    if (!authorMap.has(row.book_id)) authorMap.set(row.book_id, []);
    authorMap.get(row.book_id).push({ id: row.id, name: row.name });
  }
  res.json(books.map(b => ({
    ...b,
    cover_path: b.cover_path ? `/uploads/${b.cover_path}` : null,
    tags: tagMap.get(b.id) ?? [],
    authors: authorMap.get(b.id) ?? [],
  })));
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
