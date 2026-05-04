import express from 'express';
import db from '../db.js';
import { toCoverUrl } from '../lib/books/normalization.js';
import { attachBookCardJoinedFields } from '../lib/books/joinedFields.js';

const router = express.Router();

function getListOrFail(res, id) {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) { res.status(404).json({ error: 'List not found' }); return null; }
  return list;
}

const PAGE_SIZE = 48;

const LIST_ORDER_BY = {
  title:  "b.title COLLATE NOCASE ASC, lb.position ASC",
  author: "(SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id ORDER BY ba.position LIMIT 1) COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC",
  rating: "COALESCE(b.rating, 0) DESC, b.title COLLATE NOCASE ASC",
  added:  "lb.position ASC, lb.added_at DESC",
};

function booksForList(listId, { sort = 'added', limit = null, offset = 0 } = {}) {
  const orderBy = LIST_ORDER_BY[sort] || LIST_ORDER_BY.added;
  const limitSql = limit != null ? `LIMIT ${limit} OFFSET ${offset}` : '';
  const total = db.prepare('SELECT COUNT(*) AS c FROM list_books WHERE list_id = ?').get(listId).c;

  const rows = db.prepare(`
    SELECT b.*, lb.added_at, lb.position
    FROM books b
    JOIN list_books lb ON lb.book_id = b.id
    WHERE lb.list_id = ?
    ORDER BY ${orderBy}
    ${limitSql}
  `).all(listId);

  // Authors / narrators / tags now come back as [{id, name}] objects (same
  // shape as every other book-list endpoint). Previously this route returned
  // authors/narrators as plain string arrays — a quiet shape divergence.
  // ListDetail's formatAuthors() handles both shapes so no UI break.
  const books = attachBookCardJoinedFields(rows).map(b => ({
    ...b,
    cover_path: toCoverUrl(b.cover_path),
  }));

  return { books, total };
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
  const result = db.prepare("INSERT INTO lists (name, created_at, updated_at) VALUES (?, datetime('now', 'localtime'), datetime('now', 'localtime'))").run(name);
  res.status(201).json(db.prepare('SELECT * FROM lists WHERE id = ?').get(result.lastInsertRowid));
});

// GET /api/lists/:id — list with its books
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  const sort   = LIST_ORDER_BY[req.query.sort] ? req.query.sort : 'added';
  const limit  = req.query.limit  ? Math.min(Math.max(1, parseInt(req.query.limit)  || PAGE_SIZE), 500) : null;
  const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset) || 0) : 0;
  const { books, total } = booksForList(id, { sort, limit, offset });
  res.json({ ...list, books, total });
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
  db.prepare('UPDATE lists SET name = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(name, id);
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
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM list_books WHERE list_id = ?').get(id).m;
  db.prepare("INSERT OR IGNORE INTO list_books (list_id, book_id, position, added_at) VALUES (?, ?, ?, datetime('now', 'localtime'))").run(id, bookId, maxPos + 1);
  res.status(201).json({ ok: true });
});

// PUT /api/lists/:id/order — reorder books
router.put('/:id/order', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
  const update = db.prepare('UPDATE list_books SET position = ? WHERE list_id = ? AND book_id = ?');
  db.transaction(() => { ids.forEach((bookId, i) => update.run(i, id, bookId)); })();
  res.json({ ok: true });
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
