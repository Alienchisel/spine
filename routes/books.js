import express from 'express';
import db from '../db.js';

const router = express.Router();

function getBookWithTags(id) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!book) return null;
  const tags = db.prepare(`
    SELECT t.id, t.name FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    WHERE bt.book_id = ?
    ORDER BY t.name
  `).all(id);
  return { ...book, tags };
}

function syncTags(bookId, tagNames) {
  db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId);
  for (const name of tagNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmed);
    if (!tag) {
      const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(trimmed);
      tag = { id: result.lastInsertRowid };
    }
    db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(bookId, tag.id);
  }
}

router.get('/', (req, res) => {
  const { status } = req.query;
  const books = status
    ? db.prepare('SELECT * FROM books WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM books ORDER BY updated_at DESC').all();

  const withTags = books.map(b => {
    const tags = db.prepare(`
      SELECT t.id, t.name FROM tags t
      JOIN book_tags bt ON bt.tag_id = t.id
      WHERE bt.book_id = ?
    `).all(b.id);
    return { ...b, tags };
  });
  res.json(withTags);
});

router.get('/:id', (req, res) => {
  const book = getBookWithTags(parseInt(req.params.id));
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

router.post('/', (req, res) => {
  const { title, author, status, owned, cover_path, rating, date_started, date_finished, acquisition_source, format, binding, condition, notes, tags } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  const result = db.prepare(`
    INSERT INTO books (title, author, status, owned, cover_path, rating, date_started, date_finished, acquisition_source, format, binding, condition, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    author || null,
    status || 'unread',
    owned ? 1 : 0,
    cover_path || null,
    rating || null,
    date_started || null,
    date_finished || null,
    acquisition_source || null,
    format || null,
    binding || null,
    condition || null,
    notes || null
  );

  if (tags?.length) syncTags(result.lastInsertRowid, tags);
  res.status(201).json(getBookWithTags(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { title, author, status, owned, cover_path, rating, date_started, date_finished, acquisition_source, format, binding, condition, notes, tags } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

  db.prepare(`
    UPDATE books SET
      title = ?, author = ?, status = ?, owned = ?, cover_path = ?,
      rating = ?, date_started = ?, date_finished = ?,
      acquisition_source = ?, format = ?, binding = ?, condition = ?, notes = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title.trim(),
    author || null,
    status || 'unread',
    owned ? 1 : 0,
    cover_path || null,
    rating || null,
    date_started || null,
    date_finished || null,
    acquisition_source || null,
    format || null,
    binding || null,
    condition || null,
    notes || null,
    id
  );

  if (tags !== undefined) syncTags(id, tags);
  res.json(getBookWithTags(id));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM books WHERE id = ?').run(parseInt(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.status(204).send();
});

export default router;
