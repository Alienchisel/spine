import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadsDir = path.join(__dirname, '..', 'uploads');

function toFilename(coverPath) {
  if (!coverPath) return null;
  return coverPath.startsWith('/uploads/') ? coverPath.slice('/uploads/'.length) : coverPath;
}

function toCoverUrl(filename) {
  return filename ? `/uploads/${filename}` : null;
}

function deleteLocalCover(filename) {
  if (!filename) return;
  const abs = path.join(uploadsDir, filename);
  fs.unlink(abs, (err) => {
    if (err && err.code !== 'ENOENT') console.error(`Failed to delete cover: ${abs}`, err);
  });
}

const router = express.Router();

const VALID_STATUSES = ['reading', 'paused', 'finished', 'unread'];
const VALID_FORMATS = ['physical', 'ebook', 'audiobook'];
const VALID_BINDINGS = ['paperback', 'hardcover'];
const VALID_CONDITIONS = ['new', 'fine', 'very good', 'good', 'fair', 'poor'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(val) {
  if (!DATE_RE.test(val)) return false;
  const d = new Date(val);
  return !isNaN(d.getTime());
}

function validateBook(body) {
  const { title, author, status, format, binding, condition, rating, page_count, duration_minutes, date_started, date_finished, year_published, year_edition, isbn_10, isbn_13 } = body;
  const errors = [];

  if (!title?.trim()) errors.push('Title is required');
  if (title && title.trim().length > 500) errors.push('Title too long');
  if (author && author.length > 300) errors.push('Author too long');
  if (status && !VALID_STATUSES.includes(status)) errors.push('Invalid status');
  if (format && !VALID_FORMATS.includes(format)) errors.push('Invalid format');
  if (binding && !VALID_BINDINGS.includes(binding)) errors.push('Invalid binding');
  if (condition && !VALID_CONDITIONS.includes(condition)) errors.push('Invalid condition');
  if (rating != null && (rating < 1 || rating > 5 || !Number.isInteger(Number(rating)))) errors.push('Rating must be 1–5');
  if (page_count != null && (page_count < 1 || !Number.isInteger(Number(page_count)))) errors.push('Page count must be a positive integer');
  if (duration_minutes != null && (duration_minutes < 1 || !Number.isInteger(Number(duration_minutes)))) errors.push('Duration must be a positive integer');
  if (date_started && !isValidDate(date_started)) errors.push('Invalid date started');
  if (date_finished && !isValidDate(date_finished)) errors.push('Invalid date finished');
  if (body.acquisition_date && !isValidDate(body.acquisition_date)) errors.push('Invalid acquisition date');
  if (year_published != null && (year_published < 1 || !Number.isInteger(Number(year_published)))) errors.push('Invalid publication year');
  if (year_edition != null && (year_edition < 1 || !Number.isInteger(Number(year_edition)))) errors.push('Invalid edition year');
  if (body.series_number != null && isNaN(Number(body.series_number))) errors.push('Invalid series number');
  if (isbn_10 && !/^\d{10}$/.test(isbn_10)) errors.push('ISBN-10 must be 10 digits');
  if (isbn_13 && !/^\d{13}$/.test(isbn_13)) errors.push('ISBN-13 must be 13 digits');

  return errors;
}

function getBookWithTags(id) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!book) return null;
  const tags = db.prepare(`
    SELECT t.id, t.name FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    WHERE bt.book_id = ?
    ORDER BY t.name
  `).all(id);
  return { ...book, cover_path: toCoverUrl(book.cover_path), tags };
}

function syncTags(bookId, tagNames) {
  const seen = new Set();
  const unique = tagNames.map(n => n.trim()).filter(n => {
    if (!n) return false;
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId);
  for (const name of unique) {
    let tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name);
    if (!tag) {
      const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
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
    return { ...b, cover_path: toCoverUrl(b.cover_path), tags };
  });
  res.json(withTags);
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const book = getBookWithTags(id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

router.post('/', (req, res) => {
  const { title, author, status, owned, is_custom, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, shelf_room, shelf_unit, shelf_number, narrator, year_published, year_edition, tags } = req.body;
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const insertBook = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO books (title, author, status, owned, is_custom, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, shelf_room, shelf_unit, shelf_number, narrator, year_published, year_edition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(),
      author || null,
      status || 'unread',
      owned ? 1 : 0,
      is_custom ? 1 : 0,
      toFilename(cover_path),
      rating || null,
      date_started || null,
      date_finished || null,
      acquisition_source || null,
      acquisition_date || null,
      format || null,
      binding || null,
      condition || null,
      description || null,
      notes || null,
      page_count || null,
      duration_minutes || null,
      publisher || null,
      series || null,
      series_number || null,
      isbn_10 || null,
      isbn_13 || null,
      shelf_room || null,
      shelf_unit || null,
      shelf_number || null,
      narrator || null,
      year_published || null,
      year_edition || null
    );
    if (tags?.length) syncTags(result.lastInsertRowid, tags);
    return result.lastInsertRowid;
  });

  const id = insertBook();
  res.status(201).json(getBookWithTags(id));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const existing = db.prepare('SELECT cover_path FROM books WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { title, author, status, owned, is_custom, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, shelf_room, shelf_unit, shelf_number, narrator, year_published, year_edition, tags } = req.body;
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const updateBook = db.transaction(() => {
    db.prepare(`
      UPDATE books SET
        title = ?, author = ?, status = ?, owned = ?, is_custom = ?, cover_path = ?,
        rating = ?, date_started = ?, date_finished = ?,
        acquisition_source = ?, acquisition_date = ?,
        format = ?, binding = ?, condition = ?,
        description = ?, notes = ?, page_count = ?, duration_minutes = ?,
        publisher = ?, series = ?, series_number = ?, isbn_10 = ?, isbn_13 = ?,
        shelf_room = ?, shelf_unit = ?, shelf_number = ?, narrator = ?,
        year_published = ?, year_edition = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title.trim(),
      author || null,
      status || 'unread',
      owned ? 1 : 0,
      is_custom ? 1 : 0,
      toFilename(cover_path),
      rating || null,
      date_started || null,
      date_finished || null,
      acquisition_source || null,
      acquisition_date || null,
      format || null,
      binding || null,
      condition || null,
      description || null,
      notes || null,
      page_count || null,
      duration_minutes || null,
      publisher || null,
      series || null,
      series_number || null,
      isbn_10 || null,
      isbn_13 || null,
      shelf_room || null,
      shelf_unit || null,
      shelf_number || null,
      narrator || null,
      year_published || null,
      year_edition || null,
      id
    );
    if (tags !== undefined) syncTags(id, tags);
  });

  updateBook();
  if (existing.cover_path !== toFilename(cover_path)) deleteLocalCover(existing.cover_path);
  res.json(getBookWithTags(id));
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const { current_page, current_minutes } = req.body;
  if (current_page != null && (current_page < 0 || !Number.isInteger(Number(current_page))))
    return res.status(400).json({ error: 'Invalid page number' });
  if (current_minutes != null && (current_minutes < 0 || !Number.isInteger(Number(current_minutes))))
    return res.status(400).json({ error: 'Invalid minutes' });

  if (current_page !== undefined)
    db.prepare('UPDATE books SET current_page = ?, updated_at = datetime(\'now\') WHERE id = ?').run(current_page ?? null, id);
  if (current_minutes !== undefined)
    db.prepare('UPDATE books SET current_minutes = ?, updated_at = datetime(\'now\') WHERE id = ?').run(current_minutes ?? null, id);
  res.json(getBookWithTags(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const book = db.prepare('SELECT cover_path FROM books WHERE id = ?').get(id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM books WHERE id = ?').run(id);
  deleteLocalCover(book.cover_path);
  res.status(204).send();
});

export default router;
