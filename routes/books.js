import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import db from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadsDir = path.join(__dirname, '..', 'uploads');

function t(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

function normalizeIsbn(val) {
  if (!val) return null;
  const clean = val.trim().replace(/[-\s]/g, '');
  return clean || null;
}

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
const VALID_SOURCE_TYPES = ['primary', 'secondary'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(val) {
  if (!DATE_RE.test(val)) return false;
  const d = new Date(val);
  return !isNaN(d.getTime());
}

const PARTIAL_DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
function isValidPartialDate(val) {
  if (!PARTIAL_DATE_RE.test(val)) return false;
  const parts = val.split('-');
  if (parts.length >= 2 && (Number(parts[1]) < 1 || Number(parts[1]) > 12)) return false;
  if (parts.length === 3) {
    const day = Number(parts[2]);
    if (day < 1 || day > 31) return false;
    if (isNaN(new Date(val).getTime())) return false;
  }
  return true;
}

function validateBook(body) {
  const { title, author, status, format, binding, condition, rating, page_count, duration_minutes, date_started, date_finished, year_published, year_edition, isbn_10, isbn_13 } = body;
  const errors = [];

  if (!title?.trim()) errors.push('Title is required');
  if (title && title.trim().length > 500) errors.push('Title too long');
  if (author && author.trim().length > 300) errors.push('Author too long');
  if (status && !VALID_STATUSES.includes(status.trim())) errors.push('Invalid status');
  if (format && !VALID_FORMATS.includes(format.trim())) errors.push('Invalid format');
  if (binding && !VALID_BINDINGS.includes(binding.trim())) errors.push('Invalid binding');
  if (condition && !VALID_CONDITIONS.includes(condition.trim())) errors.push('Invalid condition');
  if (body.source_type && !VALID_SOURCE_TYPES.includes(body.source_type.trim())) errors.push('Invalid source type');
  if (rating != null && (Number(rating) < 0.5 || Number(rating) > 5 || (Number(rating) * 2) % 1 !== 0)) errors.push('Rating must be 0.5–5 in half-star increments');
  if (page_count != null && (page_count < 1 || !Number.isInteger(Number(page_count)))) errors.push('Page count must be a positive integer');
  if (duration_minutes != null && (duration_minutes < 1 || !Number.isInteger(Number(duration_minutes)))) errors.push('Duration must be a positive integer');
  if (date_started && !isValidDate(date_started.trim())) errors.push('Invalid date started');
  if (date_finished && !isValidDate(date_finished.trim())) errors.push('Invalid date finished');
  if (body.acquisition_date && !isValidPartialDate(body.acquisition_date.trim())) errors.push('Invalid acquisition date');
  if (year_published != null && (year_published < 1 || !Number.isInteger(Number(year_published)))) errors.push('Invalid publication year');
  if (year_edition != null && (year_edition < 1 || !Number.isInteger(Number(year_edition)))) errors.push('Invalid edition year');
  if (body.series_number != null && isNaN(Number(body.series_number))) errors.push('Invalid series number');
  if (isbn_10 && !/^\d{9}[\dX]$/.test(isbn_10.replace(/[-\s]/g, ''))) errors.push('Invalid ISBN-10');
  if (isbn_13 && !/^\d{13}$/.test(isbn_13.replace(/[-\s]/g, ''))) errors.push('Invalid ISBN-13');
  if (body.asin && !/^[A-Z0-9]{10}$/.test(body.asin.trim().toUpperCase())) errors.push('Invalid ASIN');

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
  return { ...book, cover_path: toCoverUrl(book.cover_path), tags: [...tags, ...computeVirtualTags(book)] };
}

const VIRTUAL_TAG_RULES = [
  {
    name: 'Antique',
    test: (book) => {
      const year = book.year_edition;
      return Boolean(year && new Date().getFullYear() - year >= 100);
    },
  },
  {
    name: 'Vintage',
    test: (book) => {
      const year = book.year_edition;
      const age = year && new Date().getFullYear() - year;
      return Boolean(age && age >= 50 && age < 100);
    },
  },
  {
    name: 'Translated',
    test: (book) => Boolean(book.original_language && book.original_language !== book.language),
  },
  {
    name: 'Re-read',
    test: (book) => book.read_count > 1,
  },
  {
    name: 'Long',
    test: (book) => book.page_count >= 500,
  },
  {
    name: 'Short',
    test: (book) => book.page_count > 0 && book.page_count <= 150,
  },
];

function computeVirtualTags(book) {
  return VIRTUAL_TAG_RULES
    .filter(r => r.test(book))
    .map(r => ({ id: null, name: r.name, virtual: true }));
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

router.get('/counts', (_req, res) => {
  const row = db.prepare(`
    SELECT
      SUM(status = 'reading')   AS reading,
      SUM(status = 'paused')    AS paused,
      SUM(status = 'finished')  AS finished,
      SUM(status = 'unread')    AS unread,
      SUM(owned = 1)            AS owned,
      SUM(previously_owned = 1) AS prev_owned,
      COUNT(*)                  AS total
    FROM books
  `).get();
  res.json({ ...row, all: row.total });
});

router.get('/', (req, res) => {
  const { status, loved } = req.query;
  const books = loved === 'true'
    ? db.prepare('SELECT * FROM books WHERE loved = 1 ORDER BY updated_at DESC').all()
    : status
      ? db.prepare('SELECT * FROM books WHERE status = ? ORDER BY updated_at DESC').all(status)
      : db.prepare('SELECT * FROM books ORDER BY updated_at DESC').all();

  const withTags = books.map(b => {
    const tags = db.prepare(`
      SELECT t.id, t.name FROM tags t
      JOIN book_tags bt ON bt.tag_id = t.id
      WHERE bt.book_id = ?
    `).all(b.id);
    return { ...b, cover_path: toCoverUrl(b.cover_path), tags: [...tags, ...computeVirtualTags(b)] };
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

router.get('/:id/log', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const rows = db.prepare(
    'SELECT date, pages_read, minutes_read FROM reading_log WHERE book_id = ? ORDER BY date DESC'
  ).all(id);
  res.json(rows);
});

router.get('/:id/lists', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const rows = db.prepare('SELECT list_id FROM list_books WHERE book_id = ?').all(id);
  res.json(rows.map(r => r.list_id));
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
  const { title, author, status, owned, previously_owned, is_custom, is_stub, loved, fiction, source_type, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, review, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, asin, language, original_language, translator, narrator, year_published, year_approximate, year_edition, shelf_id, building_id, room_id, unit_id, tags } = req.body;
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const insertBook = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO books (title, author, status, owned, previously_owned, is_custom, is_stub, loved, fiction, source_type, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, review, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, asin, language, original_language, translator, narrator, year_published, year_approximate, year_edition, shelf_id, building_id, room_id, unit_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      t(title),
      t(author),
      status || 'unread',
      owned ? 1 : 0,
      !owned && previously_owned ? 1 : 0,
      is_custom ? 1 : 0,
      is_stub ? 1 : 0,
      loved ? 1 : 0,
      fiction == null ? null : (fiction ? 1 : 0),
      t(source_type) || null,
      toFilename(cover_path),
      rating || null,
      t(date_started),
      t(date_finished),
      t(acquisition_source),
      t(acquisition_date),
      format || null,
      binding || null,
      condition || null,
      t(description),
      t(notes),
      t(review),
      page_count || null,
      duration_minutes || null,
      t(publisher),
      t(series),
      t(series_number),
      normalizeIsbn(isbn_10),
      normalizeIsbn(isbn_13),
      t(asin) ? t(asin).toUpperCase() : null,
      t(language) || 'English',
      t(original_language),
      t(translator),
      t(narrator),
      year_published || null,
      year_approximate ? 1 : 0,
      year_edition || null,
      shelf_id || null,
      !shelf_id ? (building_id || null) : null,
      !shelf_id ? (room_id || null) : null,
      !shelf_id && !room_id ? (unit_id || null) : null
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
  const existing = db.prepare('SELECT cover_path, status, read_count FROM books WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { title, author, status, owned, previously_owned, is_custom, is_stub, loved, fiction, source_type, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, review, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, asin, language, original_language, translator, narrator, year_published, year_approximate, year_edition, shelf_id, building_id, room_id, unit_id, tags } = req.body;
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const incomingReadCount = req.body.read_count != null ? Number(req.body.read_count) : null;
  const isManualReadCount = incomingReadCount !== null && incomingReadCount !== existing.read_count;
  const isFinishTransition = status === 'finished' && existing.status !== 'finished';
  const newReadCount = isManualReadCount ? incomingReadCount : existing.read_count + (isFinishTransition ? 1 : 0);

  const updateBook = db.transaction(() => {
    db.prepare(`
      UPDATE books SET
        title = ?, author = ?, status = ?, owned = ?, previously_owned = ?, is_custom = ?, is_stub = ?, loved = ?, fiction = ?, source_type = ?, cover_path = ?,
        rating = ?, date_started = ?, date_finished = ?,
        acquisition_source = ?, acquisition_date = ?,
        format = ?, binding = ?, condition = ?,
        description = ?, notes = ?, review = ?, page_count = ?, duration_minutes = ?,
        publisher = ?, series = ?, series_number = ?, isbn_10 = ?, isbn_13 = ?, asin = ?, language = ?, original_language = ?,
        translator = ?, narrator = ?,
        year_published = ?, year_approximate = ?, year_edition = ?,
        shelf_id = ?,
        building_id = ?,
        room_id = ?,
        unit_id = ?,
        read_count = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      t(title),
      t(author),
      status || 'unread',
      owned ? 1 : 0,
      !owned && previously_owned ? 1 : 0,
      is_custom ? 1 : 0,
      is_stub ? 1 : 0,
      loved ? 1 : 0,
      fiction == null ? null : (fiction ? 1 : 0),
      t(source_type) || null,
      toFilename(cover_path),
      rating || null,
      t(date_started),
      t(date_finished),
      t(acquisition_source),
      t(acquisition_date),
      format || null,
      binding || null,
      condition || null,
      t(description),
      t(notes),
      t(review),
      page_count || null,
      duration_minutes || null,
      t(publisher),
      t(series),
      t(series_number),
      normalizeIsbn(isbn_10),
      normalizeIsbn(isbn_13),
      t(asin) ? t(asin).toUpperCase() : null,
      t(language) || 'English',
      t(original_language),
      t(translator),
      t(narrator),
      year_published || null,
      year_approximate ? 1 : 0,
      year_edition || null,
      shelf_id || null,
      !shelf_id ? (building_id || null) : null,
      !shelf_id ? (room_id || null) : null,
      !shelf_id && !room_id ? (unit_id || null) : null,
      newReadCount,
      id
    );
    if (tags !== undefined) syncTags(id, tags);
    if (t(title) && t(author)) {
      db.prepare(`
        UPDATE books SET
          rating = ?, review = ?, read_count = ?,
          updated_at = datetime('now')
        WHERE id != ? AND title = ? AND author = ?
      `).run(rating || null, t(review), newReadCount, id, t(title), t(author));
    }
  });

  updateBook();
  if (existing.cover_path !== toFilename(cover_path)) deleteLocalCover(existing.cover_path);
  res.json(getBookWithTags(id));
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const existing = db.prepare('SELECT id, current_page, current_minutes FROM books WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { current_page, current_minutes, loved, on_readlist, is_stub } = req.body;
  if (current_page != null && (current_page < 0 || !Number.isInteger(Number(current_page))))
    return res.status(400).json({ error: 'Invalid page number' });
  if (current_minutes != null && (current_minutes < 0 || !Number.isInteger(Number(current_minutes))))
    return res.status(400).json({ error: 'Invalid minutes' });

  const fields = [];
  const params = [];
  if (current_page !== undefined) { fields.push('current_page = ?'); params.push(current_page ?? null); }
  if (current_minutes !== undefined) { fields.push('current_minutes = ?'); params.push(current_minutes ?? null); }
  if (loved !== undefined) { fields.push('loved = ?'); params.push(loved ? 1 : 0); }
  if (is_stub !== undefined) { fields.push('is_stub = ?'); params.push(is_stub ? 1 : 0); }
  if (on_readlist !== undefined) {
    fields.push('on_readlist = ?');
    params.push(on_readlist ? 1 : 0);
    if (on_readlist) {
      const max = db.prepare('SELECT MAX(readlist_position) as m FROM books WHERE on_readlist = 1').get();
      fields.push('readlist_position = ?');
      params.push((max.m ?? -1) + 1);
    } else {
      fields.push('readlist_position = ?');
      params.push(null);
    }
  }

  const pagesLogged   = (current_page    !== undefined && current_page    > (existing.current_page    ?? 0)) ? current_page    - (existing.current_page    ?? 0) : 0;
  const minutesLogged = (current_minutes !== undefined && current_minutes > (existing.current_minutes ?? 0)) ? current_minutes - (existing.current_minutes ?? 0) : 0;

  db.transaction(() => {
    if (fields.length) {
      db.prepare(`UPDATE books SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params, id);
    }
    if (pagesLogged > 0 || minutesLogged > 0) {
      db.prepare(`
        INSERT INTO reading_log (book_id, date, pages_read, minutes_read)
        VALUES (?, date('now'), ?, ?)
        ON CONFLICT(book_id, date) DO UPDATE SET
          pages_read   = reading_log.pages_read   + excluded.pages_read,
          minutes_read = reading_log.minutes_read + excluded.minutes_read
      `).run(id, pagesLogged, minutesLogged);
    }
  })();

  res.json(getBookWithTags(id));
});

router.post('/:id/fetch-cover', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });

  const book = db.prepare('SELECT isbn_13, isbn_10, asin, cover_path FROM books WHERE id = ?').get(id);
  if (!book) return res.status(404).json({ error: 'Not found' });

  const isbn = book.isbn_13 || book.isbn_10;
  if (!isbn) return res.status(400).json({ error: 'No ISBN on this book' });

  async function tryFetch(url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!response.ok) return null;
      const buf = Buffer.from(await response.arrayBuffer());
      return buf.length >= 2000 ? buf : null;
    } catch { return null; }
  }

  let buffer = null;

  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    if (r.ok) {
      const data = await r.json();
      const links = data.items?.[0]?.volumeInfo?.imageLinks;
      if (links) {
        const raw = links.extraLarge || links.large || links.medium || links.thumbnail;
        if (raw) {
          const url = raw.replace('&edge=curl', '').replace(/zoom=\d+/, 'zoom=0');
          buffer = await tryFetch(url);
        }
      }
    }
  } catch { /* fall through */ }

  if (!buffer) buffer = await tryFetch(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
  if (!buffer) return res.status(404).json({ error: 'Cover image not found' });

  try {
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
    await sharp(buffer).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(uploadsDir, filename));

    deleteLocalCover(book.cover_path);
    db.prepare('UPDATE books SET cover_path = ? WHERE id = ?').run(filename, id);
    res.json(getBookWithTags(id));
  } catch {
    res.status(500).json({ error: 'Failed to process cover' });
  }
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
