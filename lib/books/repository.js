import db from '../../db.js';
import { t, normalizeIsbn, toFilename, toCoverUrl, normalizeBookLocation } from './normalization.js';
import { VIRTUAL_TAG_RULES, appendWhere, buildFilterConditions, buildOrderBy } from './filters.js';
import { syncAuthors, syncNarrators, syncTranslators } from './people.js';
import { syncTags, computeVirtualTags } from './tags.js';
import { deleteLocalCover, fetchCoverBuffer, saveCoverFromBuffer } from './covers.js';
import { BOOK_TABLE_COLUMNS } from '../../shared/bookFields.js';

export function getBook(id) {
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
  const translators = db.prepare(`
    SELECT t.id, t.name FROM translators t
    JOIN book_translators bt ON bt.translator_id = t.id
    WHERE bt.book_id = ?
    ORDER BY bt.position, t.name
  `).all(id);
  return { ...book, cover_path: toCoverUrl(book.cover_path), tags: [...tags, ...computeVirtualTags(book)], narrators, authors, translators };
}

export function getBookCounts() {
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
  return { ...row, all: row.total };
}

export function getBookFacets(query) {
  const { conditions, params } = buildFilterConditions(query);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const distCol = (col, notEmpty = false) => {
    const w = notEmpty ? appendWhere(where, `${col} IS NOT NULL AND ${col} != ''`) : where;
    return db.prepare(`SELECT DISTINCT ${col} FROM books ${w} ORDER BY ${col}`).all(...params).map(r => r[col]).filter(v => v != null && v !== '');
  };
  const hasEmpty = (col) => {
    const w = appendWhere(where, `${col} IS NULL OR ${col} = ''`);
    return db.prepare(`SELECT 1 FROM books ${w} LIMIT 1`).get(...params) != null;
  };

  const formats     = distCol('format');
  const publishers  = distCol('publisher', true);
  const series      = distCol('series', true);
  const ratings     = db.prepare(`SELECT DISTINCT rating FROM books ${where ? where + ' AND rating IS NOT NULL' : 'WHERE rating IS NOT NULL'} ORDER BY rating DESC`).all(...params).map(r => r.rating);
  const authors     = db.prepare(`SELECT DISTINCT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id IN (SELECT id FROM books ${where}) ORDER BY a.name`).all(...params).map(r => r.name);
  const narrators   = db.prepare(`SELECT DISTINCT n.name FROM narrators n JOIN book_narrators bn ON bn.narrator_id = n.id WHERE bn.book_id IN (SELECT id FROM books ${where}) ORDER BY n.name`).all(...params).map(r => r.name);
  const translators = db.prepare(`SELECT DISTINCT t.name FROM translators t JOIN book_translators bt ON bt.translator_id = t.id WHERE bt.book_id IN (SELECT id FROM books ${where}) ORDER BY t.name`).all(...params).map(r => r.name);
  const sources     = distCol('acquisition_source', true);
  const langRows    = db.prepare(`SELECT language, original_language FROM books ${where}`).all(...params);
  const languages   = [...new Set(langRows.flatMap(r => [r.language, r.original_language]).filter(Boolean))].sort();

  const realTags    = db.prepare(`SELECT DISTINCT t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (SELECT id FROM books ${where}) ORDER BY t.name`).all(...params).map(r => r.name);
  const virtualTags = VIRTUAL_TAG_RULES.filter(rule => db.prepare(`SELECT 1 FROM books ${appendWhere(where, rule.sql)} LIMIT 1`).get(...params) != null).map(r => r.name);
  const tags        = [...new Set([...realTags, ...virtualTags])].sort();

  return {
    formats,    hasEmptyFormat:    hasEmpty('format'),
    publishers, hasEmptyPublisher: hasEmpty('publisher'),
    series,     hasEmptySeries:    hasEmpty('series'),
    sources,    hasEmptySource:    hasEmpty('acquisition_source'),
    ratings,    hasEmptyRating:    db.prepare(`SELECT 1 FROM books ${appendWhere(where, 'rating IS NULL')} LIMIT 1`).get(...params) != null,
    tags,
    authors, narrators, translators, languages,
  };
}

export function listBooks(query) {
  const { conditions, params } = buildFilterConditions(query);
  const where    = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy  = buildOrderBy(query.sort, query.field);
  const limit    = Math.min(Math.max(1, parseInt(query.limit) || 50), 200);
  const offset   = Math.max(0, parseInt(query.offset) || 0);

  const total = db.prepare(`SELECT COUNT(*) as n FROM books ${where}`).get(...params).n;
  const rows  = db.prepare(`SELECT * FROM books ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  const ids           = rows.map(r => r.id);
  const tagMap        = new Map(ids.map(id => [id, []]));
  const authorMap     = new Map(ids.map(id => [id, []]));
  const narratorMap   = new Map(ids.map(id => [id, []]));
  const translatorMap = new Map(ids.map(id => [id, []]));
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`SELECT bt.book_id, t.id, t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (${ph}) ORDER BY t.name`)
      .all(...ids).forEach(({ book_id, id, name }) => tagMap.get(book_id)?.push({ id, name }));
    db.prepare(`SELECT ba.book_id, a.id, a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id IN (${ph}) ORDER BY ba.position`)
      .all(...ids).forEach(({ book_id, id, name }) => authorMap.get(book_id)?.push({ id, name }));
    db.prepare(`SELECT bn.book_id, n.id, n.name FROM narrators n JOIN book_narrators bn ON bn.narrator_id = n.id WHERE bn.book_id IN (${ph}) ORDER BY bn.position`)
      .all(...ids).forEach(({ book_id, id, name }) => narratorMap.get(book_id)?.push({ id, name }));
    db.prepare(`SELECT bt.book_id, t.id, t.name FROM translators t JOIN book_translators bt ON bt.translator_id = t.id WHERE bt.book_id IN (${ph}) ORDER BY bt.position, t.name`)
      .all(...ids).forEach(({ book_id, id, name }) => translatorMap.get(book_id)?.push({ id, name }));
  }

  const books = rows.map(b => ({
    ...b,
    cover_path:  toCoverUrl(b.cover_path),
    tags:        [...(tagMap.get(b.id) || []), ...computeVirtualTags(b)],
    authors:     authorMap.get(b.id) || [],
    narrators:   narratorMap.get(b.id) || [],
    translators: translatorMap.get(b.id) || [],
  }));

  return { books, total, offset, limit };
}

// Returns the column → coerced-value map for a books-table write. Order is
// irrelevant here; bookValues() below pulls keys out in BOOK_TABLE_COLUMNS
// order so the values array always lines up with the SQL.
function bookColumns(payload, extra = {}) {
  const loc = normalizeBookLocation(payload);
  return {
    title:              t(payload.title),
    status:             payload.status || 'unread',
    owned:              payload.owned ? 1 : 0,
    previously_owned:   !payload.owned && payload.previously_owned ? 1 : 0,
    is_custom:          payload.is_custom ? 1 : 0,
    is_stub:            extra.is_stub ?? (payload.is_stub ? 1 : 0),
    loved:              payload.loved ? 1 : 0,
    fiction:            payload.fiction == null ? null : (payload.fiction ? 1 : 0),
    source_type:        t(payload.source_type) || null,
    cover_path:         toFilename(payload.cover_path),
    rating:             payload.rating || null,
    date_started:       t(payload.date_started),
    date_finished:      t(payload.date_finished),
    acquisition_source: t(payload.acquisition_source),
    acquisition_date:   t(payload.acquisition_date),
    format:             payload.format || null,
    binding:            payload.binding || null,
    condition:          payload.condition || null,
    description:        t(payload.description),
    notes:              t(payload.notes),
    review:             t(payload.review),
    page_count:         payload.page_count || null,
    duration_minutes:   payload.duration_minutes || null,
    publisher:          t(payload.publisher),
    series:             t(payload.series),
    series_number:      t(payload.series_number),
    isbn_10:            normalizeIsbn(payload.isbn_10),
    isbn_13:            normalizeIsbn(payload.isbn_13),
    asin:               t(payload.asin) ? t(payload.asin).toUpperCase() : null,
    language:           t(payload.language) || 'English',
    original_language:  t(payload.original_language),
    year_published:     payload.year_published || null,
    year_approximate:   payload.year_approximate ? 1 : 0,
    year_edition:       payload.year_edition || null,
    abridged:           payload.abridged ? 1 : 0,
    shelf_id:           loc.shelf_id,
    building_id:        loc.building_id,
    room_id:            loc.room_id,
    unit_id:            loc.unit_id,
  };
}

function bookValues(payload, extra) {
  const cols = bookColumns(payload, extra);
  return BOOK_TABLE_COLUMNS.map(c => cols[c]);
}

// Startup coverage check: catches schema drift between BOOK_TABLE_COLUMNS in
// the shared descriptor and bookColumns() here. Throws at module load (server
// start) instead of letting an unmapped column silently store NULL forever.
{
  const sample = bookColumns({}, {});
  const missing = BOOK_TABLE_COLUMNS.filter(c => !(c in sample));
  if (missing.length) throw new Error(`bookColumns() missing columns: ${missing.join(', ')}`);
  const unknown = Object.keys(sample).filter(c => !BOOK_TABLE_COLUMNS.includes(c));
  if (unknown.length) throw new Error(`bookColumns() has unknown columns: ${unknown.join(', ')}`);
}

const BOOK_INSERT_COLS  = BOOK_TABLE_COLUMNS.join(', ');
const BOOK_UPDATE_COLS  = BOOK_TABLE_COLUMNS.map(c => `${c} = ?`).join(', ');
const BOOK_PLACEHOLDERS = BOOK_TABLE_COLUMNS.map(() => '?').join(', ');

export function createBook(payload) {
  const { authors, narrators, translators, tags } = payload;
  const id = db.transaction(() => {
    const result = db.prepare(`INSERT INTO books (${BOOK_INSERT_COLS}, created_at, updated_at) VALUES (${BOOK_PLACEHOLDERS}, datetime('now', 'localtime'), datetime('now', 'localtime'))`).run(...bookValues(payload));
    const newId = result.lastInsertRowid;
    if (tags?.length)             syncTags(newId, tags);
    if (narrators   !== undefined) syncNarrators(newId, narrators);
    if (authors     !== undefined) syncAuthors(newId, authors);
    if (translators !== undefined) syncTranslators(newId, translators);
    return newId;
  })();
  return getBook(id);
}

export function updateBook(id, payload) {
  const existing = db.prepare('SELECT cover_path, status, read_count FROM books WHERE id = ?').get(id);
  if (!existing) return null;

  const { authors, narrators, translators, tags, title, status, rating, review, is_stub } = payload;
  // Manual override wins; auto-increment on finish transition is the fallback.
  // read_count is authoritative and intentionally decoupled from reads row count.
  // See docs/book-model.md § "Reading data rules" for the full contract.
  const incomingReadCount  = payload.read_count != null ? Number(payload.read_count) : null;
  const isManualReadCount  = incomingReadCount !== null && incomingReadCount !== existing.read_count;
  const isFinishTransition = status === 'finished' && existing.status !== 'finished';
  const newReadCount       = isManualReadCount ? incomingReadCount : existing.read_count + (isFinishTransition ? 1 : 0);
  const effectiveIsStub    = (is_stub && !(t(title) && authors?.length > 0)) ? 1 : 0;

  db.transaction(() => {
    db.prepare(`UPDATE books SET ${BOOK_UPDATE_COLS}, read_count = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(...bookValues(payload, { is_stub: effectiveIsStub }), newReadCount, id);
    if (tags        !== undefined) syncTags(id, tags);
    if (narrators   !== undefined) syncNarrators(id, narrators);
    if (authors     !== undefined) syncAuthors(id, authors);
    if (translators !== undefined) syncTranslators(id, translators);
    const firstAuthor = Array.isArray(authors) && authors.length > 0 ? authors[0].trim() : null;
    if (t(title) && firstAuthor) {
      db.prepare(`
        UPDATE books SET rating = ?, review = ?, read_count = ?, updated_at = datetime('now', 'localtime')
        WHERE id != ? AND title = ?
        AND id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE a.name = ? AND ba.position = 0)
      `).run(rating || null, t(review), newReadCount, id, t(title), firstAuthor);
    }
  })();

  if (existing.cover_path !== toFilename(payload.cover_path)) deleteLocalCover(existing.cover_path);
  return getBook(id);
}

export function patchBook(id, patch) {
  const existing = db.prepare('SELECT id, current_page, current_minutes FROM books WHERE id = ?').get(id);
  if (!existing) return null;

  const { current_page, current_minutes, loved, on_readlist, is_stub, fiction, acquisition_source, description } = patch;

  const fields = [];
  const params = [];
  if (current_page        !== undefined) { fields.push('current_page = ?');        params.push(current_page ?? null); }
  if (current_minutes     !== undefined) { fields.push('current_minutes = ?');     params.push(current_minutes ?? null); }
  if (loved               !== undefined) { fields.push('loved = ?');               params.push(loved ? 1 : 0); }
  if (is_stub             !== undefined) { fields.push('is_stub = ?');             params.push(is_stub ? 1 : 0); }
  if (fiction             !== undefined) { fields.push('fiction = ?');             params.push(fiction == null ? null : (fiction ? 1 : 0)); }
  if (acquisition_source  !== undefined) { fields.push('acquisition_source = ?');  params.push(acquisition_source ?? null); }
  if (description         !== undefined) { fields.push('description = ?');         params.push(description ?? null); }
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
      db.prepare(`UPDATE books SET ${fields.join(', ')}, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(...params, id);
    }
    if (pagesLogged > 0 || minutesLogged > 0) {
      db.prepare(`
        INSERT INTO reading_log (book_id, date, pages_read, minutes_read)
        VALUES (?, date('now', 'localtime'), ?, ?)
        ON CONFLICT(book_id, date) DO UPDATE SET
          pages_read   = reading_log.pages_read   + excluded.pages_read,
          minutes_read = reading_log.minutes_read + excluded.minutes_read
      `).run(id, pagesLogged, minutesLogged);
    }
  })();

  return getBook(id);
}

export function deleteBook(id) {
  const book = db.prepare('SELECT cover_path FROM books WHERE id = ?').get(id);
  if (!book) return false;
  db.prepare('DELETE FROM books WHERE id = ?').run(id);
  deleteLocalCover(book.cover_path);
  return true;
}

export async function updateBookCover(id) {
  const book = db.prepare('SELECT isbn_13, isbn_10, cover_path FROM books WHERE id = ?').get(id);
  if (!book) return { notFound: true };
  const isbn = book.isbn_13 || book.isbn_10;
  if (!isbn) return { noIsbn: true };
  const buffer = await fetchCoverBuffer(isbn);
  if (!buffer) return { coverNotFound: true };
  const filename = await saveCoverFromBuffer(buffer);
  deleteLocalCover(book.cover_path);
  db.prepare('UPDATE books SET cover_path = ? WHERE id = ?').run(filename, id);
  return { book: getBook(id) };
}
