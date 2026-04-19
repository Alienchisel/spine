import express from 'express';
import db from '../db.js';

const router = express.Router();

function getListOrFail(res, id) {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) { res.status(404).json({ error: 'List not found' }); return null; }
  return list;
}

function booksForList(listId) {
  const rows = db.prepare(`
    SELECT b.*, lb.added_at
    FROM books b
    JOIN list_books lb ON lb.book_id = b.id
    WHERE lb.list_id = ?
    ORDER BY lb.added_at DESC
  `).all(listId);
  return rows.map(b => {
    const tags = db.prepare(`
      SELECT t.id, t.name FROM tags t
      JOIN book_tags bt ON bt.tag_id = t.id
      WHERE bt.book_id = ?
    `).all(b.id);
    const cover_path = b.cover_path ? `/uploads/${b.cover_path}` : null;
    return { ...b, cover_path, tags };
  });
}

// GET /api/lists — all lists with book count
router.get('/', (_req, res) => {
  const lists = db.prepare(`
    SELECT l.*, COUNT(lb.book_id) as book_count
    FROM lists l
    LEFT JOIN list_books lb ON lb.list_id = l.id
    GROUP BY l.id
    ORDER BY l.name ASC
  `).all();
  res.json(lists);
});

// POST /api/lists — create a list
router.post('/', (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 200) return res.status(400).json({ error: 'Name too long' });
  const existing = db.prepare('SELECT id FROM lists WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(409).json({ error: 'A list with that name already exists' });
  const result = db.prepare('INSERT INTO lists (name) VALUES (?)').run(name);
  res.status(201).json(db.prepare('SELECT * FROM lists WHERE id = ?').get(result.lastInsertRowid));
});

// GET /api/lists/:id — list with its books
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  res.json({ ...list, books: booksForList(id) });
});

// PUT /api/lists/:id — rename
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 200) return res.status(400).json({ error: 'Name too long' });
  const conflict = db.prepare('SELECT id FROM lists WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);
  if (conflict) return res.status(409).json({ error: 'A list with that name already exists' });
  db.prepare('UPDATE lists SET name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, id);
  res.json(db.prepare('SELECT * FROM lists WHERE id = ?').get(id));
});

// DELETE /api/lists/:id
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  db.prepare('DELETE FROM lists WHERE id = ?').run(id);
  res.status(204).end();
});

// POST /api/lists/:id/books — add a book
router.post('/:id/books', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  const bookId = Number(req.body.book_id);
  if (!Number.isInteger(bookId) || bookId < 1) return res.status(400).json({ error: 'Invalid book_id' });
  const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  db.prepare('INSERT OR IGNORE INTO list_books (list_id, book_id) VALUES (?, ?)').run(id, bookId);
  res.status(201).json({ ok: true });
});

// DELETE /api/lists/:id/books/:bookId — remove a book
router.delete('/:id/books/:bookId', (req, res) => {
  const id = Number(req.params.id);
  const bookId = Number(req.params.bookId);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  if (!Number.isInteger(bookId) || bookId < 1) return res.status(400).json({ error: 'Invalid book id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  db.prepare('DELETE FROM list_books WHERE list_id = ? AND book_id = ?').run(id, bookId);
  res.status(204).end();
});

export default router;
