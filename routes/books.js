import express from 'express';
import db from '../db.js';
import { t, normalizeIsbn, toFilename, toCoverUrl } from '../lib/books/normalization.js';
import { validateBook, isValidDate } from '../lib/books/validation.js';
import { VIRTUAL_TAG_RULES, appendWhere, buildFilterConditions, buildOrderBy } from '../lib/books/filters.js';
import { syncAuthors, syncNarrators } from '../lib/books/people.js';
import { syncTags, computeVirtualTags } from '../lib/books/tags.js';
import { deleteLocalCover, fetchCoverBuffer, saveCoverFromBuffer } from '../lib/books/covers.js';

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
  const narrators = db.prepare(`
    SELECT n.id, n.name FROM narrators n
    JOIN book_narrators bn ON bn.narrator_id = n.id
    WHERE bn.book_id = ?
    ORDER BY bn.position, n.name
  `).all(id);
  const authors = db.prepare(`
    SELECT a.id, a.name FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    WHERE ba.book_id = ?
    ORDER BY ba.position
  `).all(id);
  return { ...book, cover_path: toCoverUrl(book.cover_path), tags: [...tags, ...computeVirtualTags(book)], narrators, authors };
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

router.get('/facets', (req, res) => {
  const { conditions, params } = buildFilterConditions(req.query);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const distCol = (col, notEmpty = false) => {
    const w = notEmpty ? appendWhere(where, `${col} IS NOT NULL AND ${col} != ''`) : where;
    return db.prepare(`SELECT DISTINCT ${col} FROM books ${w} ORDER BY ${col}`).all(...params).map(r => r[col]).filter(v => v != null && v !== '');
  };
  const hasEmpty = (col) => {
    const w = appendWhere(where, `${col} IS NULL OR ${col} = ''`);
    return db.prepare(`SELECT 1 FROM books ${w} LIMIT 1`).get(...params) != null;
  };

  const formats    = distCol('format');
  const publishers = distCol('publisher', true);
  const series     = distCol('series', true);
  const ratings    = db.prepare(`SELECT DISTINCT rating FROM books ${where ? where + ' AND rating IS NOT NULL' : 'WHERE rating IS NOT NULL'} ORDER BY rating DESC`).all(...params).map(r => r.rating);
  const authors    = db.prepare(`
    SELECT DISTINCT a.name FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    WHERE ba.book_id IN (SELECT id FROM books ${where})
    ORDER BY a.name
  `).all(...params).map(r => r.name);
  const narrators  = db.prepare(`
    SELECT DISTINCT n.name FROM narrators n
    JOIN book_narrators bn ON bn.narrator_id = n.id
    WHERE bn.book_id IN (SELECT id FROM books ${where})
    ORDER BY n.name
  `).all(...params).map(r => r.name);
  const translators = distCol('translator', true);
  const sources    = distCol('acquisition_source', true);
  const langRows   = db.prepare(`SELECT language, original_language FROM books ${where}`).all(...params);
  const languages  = [...new Set(langRows.flatMap(r => [r.language, r.original_language]).filter(Boolean))].sort();

  const realTagRows = db.prepare(`SELECT DISTINCT t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (SELECT id FROM books ${where}) ORDER BY t.name`).all(...params);
  const realTags = realTagRows.map(r => r.name);
  const virtualTags = VIRTUAL_TAG_RULES.filter(rule => {
    const w = appendWhere(where, rule.sql);
    return db.prepare(`SELECT 1 FROM books ${w} LIMIT 1`).get(...params) != null;
  }).map(r => r.name);
  const tags = [...new Set([...realTags, ...virtualTags])].sort();

  res.json({
    formats,    hasEmptyFormat:    hasEmpty('format'),
    publishers, hasEmptyPublisher: hasEmpty('publisher'),
    series,     hasEmptySeries:    hasEmpty('series'),
    ratings,    hasEmptyRating:    db.prepare(`SELECT 1 FROM books ${appendWhere(where, 'rating IS NULL')} LIMIT 1`).get(...params) != null,
    tags,
    authors, narrators, translators, sources, languages,
  });
});

router.get('/', (req, res) => {
  const { conditions, params } = buildFilterConditions(req.query);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = buildOrderBy(req.query.sort, req.query.field);
  const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 200);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);

  const total = db.prepare(`SELECT COUNT(*) as n FROM books ${where}`).get(...params).n;

  const rows = db.prepare(`SELECT * FROM books ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  const ids = rows.map(r => r.id);
  const tagMap = new Map(ids.map(id => [id, []]));
  const authorMap = new Map(ids.map(id => [id, []]));
  const narratorMap = new Map(ids.map(id => [id, []]));
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`SELECT bt.book_id, t.id, t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (${ph}) ORDER BY t.name`)
      .all(...ids)
      .forEach(({ book_id, id, name }) => tagMap.get(book_id)?.push({ id, name }));
    db.prepare(`SELECT ba.book_id, a.id, a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id IN (${ph}) ORDER BY ba.position`)
      .all(...ids)
      .forEach(({ book_id, id, name }) => authorMap.get(book_id)?.push({ id, name }));
    db.prepare(`SELECT bn.book_id, n.id, n.name FROM narrators n JOIN book_narrators bn ON bn.narrator_id = n.id WHERE bn.book_id IN (${ph}) ORDER BY bn.position`)
      .all(...ids)
      .forEach(({ book_id, id, name }) => narratorMap.get(book_id)?.push({ id, name }));
  }

  const books = rows.map(b => ({
    ...b,
    cover_path: toCoverUrl(b.cover_path),
    tags: [...(tagMap.get(b.id) || []), ...computeVirtualTags(b)],
    authors: authorMap.get(b.id) || [],
    narrators: narratorMap.get(b.id) || [],
  }));

  res.json({ books, total, offset, limit });
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
  const { title, authors, status, owned, previously_owned, is_custom, is_stub, loved, fiction, source_type, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, review, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, asin, language, original_language, translator, narrators, year_published, year_approximate, year_edition, shelf_id, building_id, room_id, unit_id, tags } = req.body;
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const insertBook = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO books (title, status, owned, previously_owned, is_custom, is_stub, loved, fiction, source_type, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, review, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, asin, language, original_language, translator, year_published, year_approximate, year_edition, shelf_id, building_id, room_id, unit_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      t(title),
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
      year_published || null,
      year_approximate ? 1 : 0,
      year_edition || null,
      shelf_id || null,
      !shelf_id ? (building_id || null) : null,
      !shelf_id ? (room_id || null) : null,
      !shelf_id && !room_id ? (unit_id || null) : null
    );
    if (tags?.length) syncTags(result.lastInsertRowid, tags);
    if (narrators !== undefined) syncNarrators(result.lastInsertRowid, narrators);
    if (authors !== undefined) syncAuthors(result.lastInsertRowid, authors);
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

  const { title, authors, status, owned, previously_owned, is_custom, is_stub, loved, fiction, source_type, cover_path, rating, date_started, date_finished, acquisition_source, acquisition_date, format, binding, condition, description, notes, review, page_count, duration_minutes, publisher, series, series_number, isbn_10, isbn_13, asin, language, original_language, translator, narrators, year_published, year_approximate, year_edition, shelf_id, building_id, room_id, unit_id, tags } = req.body;
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const incomingReadCount = req.body.read_count != null ? Number(req.body.read_count) : null;
  const isManualReadCount = incomingReadCount !== null && incomingReadCount !== existing.read_count;
  const isFinishTransition = status === 'finished' && existing.status !== 'finished';
  const newReadCount = isManualReadCount ? incomingReadCount : existing.read_count + (isFinishTransition ? 1 : 0);
  const effectiveIsStub = (is_stub && !(t(title) && authors?.length > 0)) ? 1 : 0;

  const updateBook = db.transaction(() => {
    db.prepare(`
      UPDATE books SET
        title = ?, status = ?, owned = ?, previously_owned = ?, is_custom = ?, is_stub = ?, loved = ?, fiction = ?, source_type = ?, cover_path = ?,
        rating = ?, date_started = ?, date_finished = ?,
        acquisition_source = ?, acquisition_date = ?,
        format = ?, binding = ?, condition = ?,
        description = ?, notes = ?, review = ?, page_count = ?, duration_minutes = ?,
        publisher = ?, series = ?, series_number = ?, isbn_10 = ?, isbn_13 = ?, asin = ?, language = ?, original_language = ?,
        translator = ?,
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
      status || 'unread',
      owned ? 1 : 0,
      !owned && previously_owned ? 1 : 0,
      is_custom ? 1 : 0,
      effectiveIsStub,
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
    if (narrators !== undefined) syncNarrators(id, narrators);
    if (authors !== undefined) syncAuthors(id, authors);
    const firstAuthor = Array.isArray(authors) && authors.length > 0 ? authors[0].trim() : null;
    if (t(title) && firstAuthor) {
      db.prepare(`
        UPDATE books SET
          rating = ?, review = ?, read_count = ?,
          updated_at = datetime('now')
        WHERE id != ? AND title = ?
        AND id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE a.name = ? AND ba.position = 0)
      `).run(rating || null, t(review), newReadCount, id, t(title), firstAuthor);
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

  const { current_page, current_minutes, loved, on_readlist, is_stub, fiction, acquisition_source, description } = req.body;
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
  if (fiction !== undefined) { fields.push('fiction = ?'); params.push(fiction == null ? null : (fiction ? 1 : 0)); }
  if (acquisition_source !== undefined) { fields.push('acquisition_source = ?'); params.push(acquisition_source ?? null); }
  if (description !== undefined) { fields.push('description = ?'); params.push(description ?? null); }
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

  const buffer = await fetchCoverBuffer(isbn);
  if (!buffer) return res.status(404).json({ error: 'Cover image not found' });

  try {
    const filename = await saveCoverFromBuffer(buffer);
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
