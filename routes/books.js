import express from 'express';
import db from '../db.js';
import { validateBook, isValidDate } from '../lib/books/validation.js';
import { getBook, getBookCounts, getBookFacets, listBooks, createBook, updateBook, patchBook, deleteBook, updateBookCover } from '../lib/books/repository.js';

const router = express.Router();

router.get('/counts', (_req, res) => {
  res.json(getBookCounts());
});

router.get('/facets', (req, res) => {
  res.json(getBookFacets(req.query));
});

router.get('/', (req, res) => {
  res.json(listBooks(req.query));
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const book = getBook(id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

router.get('/:id/log', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  res.json(db.prepare('SELECT date, pages_read, minutes_read FROM reading_log WHERE book_id = ? ORDER BY date DESC').all(id));
});

router.get('/:id/lists', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  res.json(db.prepare('SELECT list_id FROM list_books WHERE book_id = ?').all(id).map(r => r.list_id));
});

router.get('/:id/reads', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  res.json(db.prepare('SELECT * FROM reads WHERE book_id = ? ORDER BY COALESCE(date_finished, date_started, created_at) ASC').all(id));
});

router.post('/:id/reads', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  const { date_started, date_finished } = req.body;
  if (date_started && !isValidDate(date_started)) return res.status(400).json({ error: 'Invalid date_started' });
  if (date_finished && !isValidDate(date_finished)) return res.status(400).json({ error: 'Invalid date_finished' });
  if (date_started && date_finished && date_finished < date_started) return res.status(400).json({ error: 'date_finished cannot be before date_started' });
  const result = db.prepare('INSERT INTO reads (book_id, date_started, date_finished) VALUES (?, ?, ?)').run(id, date_started || null, date_finished || null);
  res.status(201).json(db.prepare('SELECT * FROM reads WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id/reads/:readId', (req, res) => {
  const id = Number(req.params.id);
  const readId = Number(req.params.readId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(readId) || readId < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM reads WHERE id = ? AND book_id = ?').get(readId, id)) return res.status(404).json({ error: 'Not found' });
  const { date_started, date_finished } = req.body;
  if (date_started && !isValidDate(date_started)) return res.status(400).json({ error: 'Invalid date_started' });
  if (date_finished && !isValidDate(date_finished)) return res.status(400).json({ error: 'Invalid date_finished' });
  if (date_started && date_finished && date_finished < date_started) return res.status(400).json({ error: 'date_finished cannot be before date_started' });
  db.prepare('UPDATE reads SET date_started = ?, date_finished = ? WHERE id = ?').run(date_started || null, date_finished || null, readId);
  res.json(db.prepare('SELECT * FROM reads WHERE id = ?').get(readId));
});

router.delete('/:id/reads/:readId', (req, res) => {
  const id = Number(req.params.id);
  const readId = Number(req.params.readId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(readId) || readId < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM reads WHERE id = ? AND book_id = ?').get(readId, id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM reads WHERE id = ?').run(readId);
  res.status(204).send();
});

router.post('/', (req, res) => {
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });
  res.status(201).json(createBook(req.body));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });
  const book = updateBook(id, req.body);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const { current_page, current_minutes } = req.body;
  if (current_page != null) {
    const n = Number(current_page);
    if (current_page === '' || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'Invalid page number' });
    req.body.current_page = n;
  }
  if (current_minutes != null) {
    const n = Number(current_minutes);
    if (current_minutes === '' || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'Invalid minutes' });
    req.body.current_minutes = n;
  }
  const book = patchBook(id, req.body);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

router.post('/:id/fetch-cover', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  try {
    const result = await updateBookCover(id);
    if (result.notFound)     return res.status(404).json({ error: 'Not found' });
    if (result.noIsbn)       return res.status(400).json({ error: 'No ISBN on this book' });
    if (result.coverNotFound) return res.status(404).json({ error: 'Cover image not found' });
    res.json(result.book);
  } catch {
    res.status(500).json({ error: 'Failed to process cover' });
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  if (!deleteBook(id)) return res.status(404).json({ error: 'Not found' });
  res.status(204).send();
});

export default router;
