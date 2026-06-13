import express from 'express';
import db, { nrm } from '../db.js';
import { serveBookCardRows, LIST_BOOK_SELECT_PREFIXED } from '../lib/books/joinedFields.js';

const router = express.Router();

function getListOrFail(res, id) {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) { res.status(404).json({ error: 'List not found' }); return null; }
  return list;
}

const PAGE_SIZE = 48;

const LIST_ORDER_BY = {
  title:  "nrm(b.title) ASC, lb.position ASC",
  author: "nrm(COALESCE((SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = b.id ORDER BY ba.position LIMIT 1), '')) ASC, nrm(b.title) ASC",
  rating: "COALESCE(b.rating, 0) DESC, nrm(b.title) ASC",
  added:  "lb.position ASC, lb.added_at DESC",
  // Chronological by original year of publication. NULL years sort last
  // in both directions so unknowns don't crowd the top — same convention
  // as Author page year sorts. Tiebreakers fall through series_number
  // then title so volume-2-of-a-1789-series still lands after volume-1.
  year_published:      "(b.year_published IS NULL), b.year_published ASC,  COALESCE(b.series_number, 9999) ASC, nrm(b.title) ASC",
  year_published_desc: "(b.year_published IS NULL), b.year_published DESC, COALESCE(b.series_number, 9999) ASC, nrm(b.title) ASC",
};

function booksForList(listId, { sort = 'added', limit = null, offset = 0 } = {}) {
  const orderBy = LIST_ORDER_BY[sort] || LIST_ORDER_BY.added;
  const limitSql = limit != null ? `LIMIT ${limit} OFFSET ${offset}` : '';
  // Archived books are excluded from list views and from the count so the
  // overview badge matches what's actually visible. Membership in list_books
  // is preserved across archive/un-archive — the row reappears intact when
  // the user un-archives.
  // owned_count and finished_count power the Letterboxd-style completion
  // indicators on the list detail page; computed alongside total over the
  // same non-archived set so the percentages always read against the same
  // denominator the user sees.
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN b.owned = 1            THEN 1 ELSE 0 END) AS owned,
      SUM(CASE WHEN b.status = 'finished'  THEN 1 ELSE 0 END) AS finished
    FROM list_books lb
    JOIN books b ON b.id = lb.book_id
    WHERE lb.list_id = ? AND COALESCE(b.archived,0) = 0
  `).get(listId);

  const rows = db.prepare(`
    SELECT ${LIST_BOOK_SELECT_PREFIXED}, lb.added_at, lb.position
    FROM books b
    JOIN list_books lb ON lb.book_id = b.id
    WHERE lb.list_id = ? AND COALESCE(b.archived,0) = 0
    ORDER BY ${orderBy}
    ${limitSql}
  `).all(listId);

  return {
    books: serveBookCardRows(rows),
    total: counts.total,
    owned_count: counts.owned ?? 0,
    finished_count: counts.finished ?? 0,
  };
}

// GET /api/lists — all lists with book count and completion counts
router.get('/', (_req, res) => {
  // book_count, owned_count, and finished_count all exclude archived books
  // so the overview metrics match what the list detail view will show.
  // The `b.id IS NOT NULL` guard is load-bearing: a list with zero books
  // produces a single LEFT-JOIN row with all b.* columns NULL, and a naive
  // COALESCE(b.archived,0) = 0 would count that phantom row as a book.
  const lists = db.prepare(`
    SELECT l.*,
      COUNT(CASE WHEN b.id IS NOT NULL AND COALESCE(b.archived,0) = 0                            THEN 1 END) AS book_count,
      COUNT(CASE WHEN b.id IS NOT NULL AND COALESCE(b.archived,0) = 0 AND b.owned = 1            THEN 1 END) AS owned_count,
      COUNT(CASE WHEN b.id IS NOT NULL AND COALESCE(b.archived,0) = 0 AND b.status = 'finished'  THEN 1 END) AS finished_count
    FROM lists l
    LEFT JOIN list_books lb ON lb.list_id = l.id
    LEFT JOIN books b ON b.id = lb.book_id
    GROUP BY l.id
    ORDER BY l.name ASC
  `).all();
  res.json(lists);
});

const DESCRIPTION_MAX = 2000;

// Trim a free-text field; empty string collapses to null so the column
// stores absence consistently (not a mix of '' and NULL the UI would
// have to disambiguate). Mirrors lib/books/normalization.js `t()`.
function trimToNull(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

// default_sort is one of the LIST_ORDER_BY keys (the same vocabulary the
// `sort` query param accepts) or null. Validated at the route boundary so
// a typo from a direct API call can't seed a value the GET path doesn't
// recognise.
function validDefaultSort(val) {
  return val == null || Object.prototype.hasOwnProperty.call(LIST_ORDER_BY, val);
}

// POST /api/lists — create a list
router.post('/', (req, res) => {
  const name = req.body.name?.trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 200) return res.status(400).json({ error: 'Name too long' });
  const description = trimToNull(req.body.description);
  if (description && description.length > DESCRIPTION_MAX) {
    return res.status(400).json({ error: 'Description too long' });
  }
  const default_sort = req.body.default_sort ?? null;
  if (!validDefaultSort(default_sort)) {
    return res.status(400).json({ error: 'Invalid default_sort' });
  }
  const existing = db.prepare('SELECT id FROM lists WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(409).json({ error: 'A list with that name already exists' });
  const result = db.prepare("INSERT INTO lists (name, description, default_sort, created_at, updated_at) VALUES (?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))").run(name, description, default_sort);
  res.status(201).json(db.prepare('SELECT * FROM lists WHERE id = ?').get(result.lastInsertRowid));
});

// GET /api/lists/:id — list with its books
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;
  // Sort precedence: explicit `?sort=` query → stored `default_sort` →
  // 'added'. The query param wins so users can preview a different sort
  // (or share a URL with one) without overwriting the per-list memory.
  const sort = LIST_ORDER_BY[req.query.sort]
    ? req.query.sort
    : (LIST_ORDER_BY[list.default_sort] ? list.default_sort : 'added');
  const limit  = req.query.limit  ? Math.min(Math.max(1, parseInt(req.query.limit)  || PAGE_SIZE), 500) : null;
  const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset) || 0) : 0;
  const { books, total, owned_count, finished_count } = booksForList(id, { sort, limit, offset });
  res.json({ ...list, books, total, owned_count, finished_count });
});

// PUT /api/lists/:id — update name, description, and/or default_sort.
// Each field is individually optional: send `{ name }` to rename,
// `{ description }` to edit the description, `{ default_sort }` to
// change the per-list sort memory, or any combination at once. Absent
// keys leave the stored value untouched (vs. sending `description: ""`
// or `default_sort: null` which clear).
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid list id' });
  const list = getListOrFail(res, id);
  if (!list) return;

  const fields = [];
  const params = [];

  if (req.body.name !== undefined) {
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (name.length > 200) return res.status(400).json({ error: 'Name too long' });
    const conflict = db.prepare('SELECT id FROM lists WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);
    if (conflict) return res.status(409).json({ error: 'A list with that name already exists' });
    fields.push('name = ?');
    params.push(name);
  }

  if (req.body.description !== undefined) {
    const description = trimToNull(req.body.description);
    if (description && description.length > DESCRIPTION_MAX) {
      return res.status(400).json({ error: 'Description too long' });
    }
    fields.push('description = ?');
    params.push(description);
  }

  if (req.body.default_sort !== undefined) {
    const ds = req.body.default_sort;
    if (!validDefaultSort(ds)) {
      return res.status(400).json({ error: 'Invalid default_sort' });
    }
    fields.push('default_sort = ?');
    params.push(ds);
  }

  if (fields.length === 0) {
    return res.json(list);
  }

  fields.push("updated_at = datetime('now', 'localtime')");
  params.push(id);
  db.prepare(`UPDATE lists SET ${fields.join(', ')} WHERE id = ?`).run(...params);
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
  // Same pattern as shelf.js / readlist.js — without the per-element check,
  // bad book ids (strings, floats, negatives) silently fail to match the
  // `WHERE book_id = ?` filter and leave the list order untouched. Fail
  // loudly instead.
  if (!Array.isArray(ids) || !ids.every(bookId => Number.isInteger(bookId) && bookId >= 1)) {
    return res.status(400).json({ error: 'ids must be an array of positive integers' });
  }
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
