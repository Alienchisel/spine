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
  // Hide archived siblings when the current book is non-archived — mirrors
  // the Library default-view rule that archived rows surface only on
  // tab=archived / when explicitly opting in. If the current book is itself
  // archived, the user is already in opt-in territory; show every sibling.
  // rating and read_count are surfaced per sibling so EditionsSection
  // can display "5★ · Read 2×" inline, since edition propagation no
  // longer keeps these in sync (each edition owns its own state).
  const editions = book.work_id != null ? db.prepare(`
    SELECT id, title, format, status, date_finished, cover_path, rating, read_count
    FROM books
    WHERE work_id = ? AND id != ?
      AND (? = 1 OR COALESCE(archived,0) = 0)
    ORDER BY date_finished DESC, id ASC
  `).all(book.work_id, id, book.archived ? 1 : 0).map(e => ({ ...e, cover_path: toCoverUrl(e.cover_path) })) : [];
  // Stories — table-of-contents tracking for short-story collections /
  // anthologies. Always fetched (cheap), surfaced on BookDetail only when
  // the parent has the Stories or Anthology tag, or when at least one
  // story is already attached. Layer 2 adds page_start / page_end columns
  // and a story_authors join (per-story attribution that overrides the
  // book's authors — see syncStoryAuthors).
  const storyRows = db.prepare(
    'SELECT * FROM stories WHERE book_id = ? ORDER BY COALESCE(position, 9999999) ASC, id ASC'
  ).all(id);
  const storyAuthorMap = new Map(storyRows.map(s => [s.id, []]));
  if (storyRows.length) {
    const ph = storyRows.map(() => '?').join(',');
    const sids = storyRows.map(s => s.id);
    db.prepare(`
      SELECT sa.story_id, a.id, a.name FROM authors a
      JOIN story_authors sa ON sa.author_id = a.id
      WHERE sa.story_id IN (${ph})
      ORDER BY sa.position
    `).all(...sids).forEach(({ story_id, id, name }) => storyAuthorMap.get(story_id)?.push({ id, name }));
  }
  const stories = storyRows.map(s => ({ ...s, authors: storyAuthorMap.get(s.id) }));
  return { ...book, cover_path: toCoverUrl(book.cover_path), tags: [...tags, ...computeVirtualTags(book)], narrators, authors, translators, editions, stories };
}

// Link two books as alternate editions of the same underlying work. Books
// in the same group share a non-NULL work_id; the symmetry of the
// relationship is structural — every member sees every other via
// `WHERE work_id = ? AND id != self`. Returns the post-link book payload
// for `idA`, or null if either book is missing.
export function linkEditions(idA, idB) {
  if (idA === idB) return null;
  const fn = db.transaction(() => {
    const a = db.prepare('SELECT id, work_id FROM books WHERE id = ?').get(idA);
    const b = db.prepare('SELECT id, work_id FROM books WHERE id = ?').get(idB);
    if (!a || !b) return null;
    if (a.work_id != null && a.work_id === b.work_id) return getBook(idA);  // already linked
    if (a.work_id == null && b.work_id == null) {
      // Neither book is in a group yet — mint a fresh work_id and stamp both.
      const next = db.prepare('SELECT COALESCE(MAX(work_id), 0) + 1 AS w FROM books').get().w;
      db.prepare('UPDATE books SET work_id = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id IN (?, ?)').run(next, idA, idB);
    } else if (a.work_id == null) {
      db.prepare('UPDATE books SET work_id = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(b.work_id, idA);
    } else if (b.work_id == null) {
      db.prepare('UPDATE books SET work_id = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(a.work_id, idB);
    } else {
      // Both books already belong to different groups — merge into the lower
      // id so the choice is deterministic regardless of argument order.
      const target = Math.min(a.work_id, b.work_id);
      const source = Math.max(a.work_id, b.work_id);
      db.prepare('UPDATE books SET work_id = ?, updated_at = datetime(\'now\', \'localtime\') WHERE work_id = ?').run(target, source);
    }
    return getBook(idA);
  });
  return fn();
}

// Remove a book from its edition group. If the group's remaining
// membership drops to one, dissolve it — a stamped work_id on a single
// book would be a phantom group equivalent to NULL.
export function unlinkEdition(id) {
  const fn = db.transaction(() => {
    const book = db.prepare('SELECT id, work_id FROM books WHERE id = ?').get(id);
    if (!book) return null;
    if (book.work_id == null) return getBook(id);  // already unlinked, no-op
    const wid = book.work_id;
    db.prepare('UPDATE books SET work_id = NULL, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(id);
    const remaining = db.prepare('SELECT id FROM books WHERE work_id = ?').all(wid);
    if (remaining.length === 1) {
      db.prepare('UPDATE books SET work_id = NULL, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(remaining[0].id);
    }
    return getBook(id);
  });
  return fn();
}

export function getBookCounts() {
  // Archived books are excluded from "current library" counts so the Library
  // tab strip reads as the size of the active corpus. The Archived tab gets
  // its own count (computed separately, only counting archived). all/total
  // here mean "active library size", not "every book in the database".
  const row = db.prepare(`
    SELECT
      SUM(status = 'reading'   AND COALESCE(archived,0) = 0) AS reading,
      SUM(status = 'finished'  AND COALESCE(archived,0) = 0) AS finished,
      SUM(status = 'unread'    AND COALESCE(archived,0) = 0) AS unread,
      SUM(owned = 1 AND COALESCE(is_custom,0) = 0
                    AND COALESCE(acquisition_source,'') != 'Internet'
                    AND COALESCE(archived,0) = 0)            AS owned,
      SUM(previously_owned = 1 AND COALESCE(archived,0) = 0) AS prev_owned,
      SUM(owned = 0 AND COALESCE(previously_owned,0) = 0
                    AND COALESCE(is_custom,0) = 0
                    AND COALESCE(archived,0) = 0)            AS never_owned,
      SUM(archived = 1)                                      AS archived,
      SUM(COALESCE(archived,0) = 0)                          AS total
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
  const orderBy  = buildOrderBy(query.sort, query.field, query.seed);
  const limit    = Math.min(Math.max(1, parseInt(query.limit) || 50), 200);
  const offset   = Math.max(0, parseInt(query.offset) || 0);

  const total = db.prepare(`SELECT COUNT(*) as n FROM books ${where}`).get(...params).n;
  const rows  = db.prepare(`SELECT * FROM books ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  const ids           = rows.map(r => r.id);
  const tagMap        = new Map(ids.map(id => [id, []]));
  const authorMap     = new Map(ids.map(id => [id, []]));
  const narratorMap   = new Map(ids.map(id => [id, []]));
  const translatorMap = new Map(ids.map(id => [id, []]));
  // Per-book "currently reading" story, surfaced on the Library Reading
  // tab as a subline under the progress label. Only populated for books
  // with a story currently in status='reading'; the first by position
  // wins when (rare) multiple are simultaneously open. Null when the
  // book has no stories or none are 'reading'.
  const currentStoryMap = new Map(ids.map(id => [id, null]));
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
    // First-by-position wins. NULL position sorts last via COALESCE,
    // matching the Contents-list rendering order in StoriesSection.
    db.prepare(`
      SELECT book_id, id, title, position FROM stories
      WHERE status = 'reading' AND book_id IN (${ph})
      ORDER BY book_id, COALESCE(position, 9999999), id
    `).all(...ids).forEach(({ book_id, id, title, position }) => {
      if (currentStoryMap.get(book_id) == null) {
        currentStoryMap.set(book_id, { id, title, position });
      }
    });
  }

  const books = rows.map(b => ({
    ...b,
    cover_path:    toCoverUrl(b.cover_path),
    tags:          [...(tagMap.get(b.id) || []), ...computeVirtualTags(b)],
    authors:       authorMap.get(b.id) || [],
    narrators:     narratorMap.get(b.id) || [],
    translators:   translatorMap.get(b.id) || [],
    current_story: currentStoryMap.get(b.id) || null,
  }));

  return { books, total, offset, limit };
}

// Returns the column → coerced-value map for a books-table write. Order is
// irrelevant here; bookValues() below pulls keys out in BOOK_TABLE_COLUMNS
// order so the values array always lines up with the SQL.
function bookColumns(payload, extra = {}) {
  // Format-gated columns. The form clears these on format change in
  // CoreFields.jsx:22-25; the backend mirrors that so a direct API call
  // can't store nonsensical combinations (e.g. a paperback audiobook).
  const isPhysical  = payload.format === 'physical';
  const isAudiobook = payload.format === 'audiobook';
  // Custom collections are assembled by the user, so they're always "owned"
  // and never have an acquisition source/date. The form mirrors this in
  // AcquisitionFields.jsx:31-41 (toggling is_custom forces owned and clears
  // the acquisition fields). The backend enforces the same contract so a
  // direct API call can't create a custom item that's previously_owned or
  // carries acquisition metadata the UI would never send.
  const isCustom = payload.is_custom ? 1 : 0;
  // Effective ownership for downstream gates (shelf, condition). is_custom
  // forces owned=1 regardless of payload.owned, so use this instead of
  // payload.owned in the gates below.
  const isOwned = !!isCustom || !!payload.owned;
  // Shelves only hold physical books you own. AcquisitionFields.jsx:44 hides
  // the picker unless `owned && format === 'physical'`; the backend mirrors
  // that so a direct API call can't shelf a non-physical or non-owned book.
  // (Previously-owned and never-owned books shouldn't carry shelf data — you
  // can't shelve a book you don't have.)
  const isShelvable = isOwned && (payload.format == null || payload.format === 'physical');
  const loc = isShelvable
    ? normalizeBookLocation(payload)
    : { shelf_id: null, unit_id: null, room_id: null, building_id: null };
  // Normalize fiction once so the source_type gate below reads the same
  // value as the column write. SQLite stores 0/1, so a roundtripped record
  // (GET → PUT) carries integer 0 for non-fiction; a strict `=== false`
  // check would silently drop source_type on that path.
  const fictionNorm = payload.fiction == null ? null : (payload.fiction ? 1 : 0);
  return {
    title:              t(payload.title),
    status:             payload.status || 'unread',
    owned:              isCustom ? 1 : (payload.owned ? 1 : 0),
    previously_owned:   isCustom ? 0 : (!payload.owned && payload.previously_owned ? 1 : 0),
    is_custom:          isCustom,
    is_stub:            extra.is_stub ?? (payload.is_stub ? 1 : 0),
    loved:              payload.loved ? 1 : 0,
    fiction:            fictionNorm,
    // source_type classifies non-fiction works (primary vs secondary). The
    // form clears it unless fiction === false (CoreFields.jsx:64); the
    // backend mirrors that so a direct API call can't tag a fiction or
    // unset-fiction book as primary/secondary.
    source_type:        fictionNorm === 0 ? (t(payload.source_type) || null) : null,
    cover_path:         extra.cover_path !== undefined ? extra.cover_path : toFilename(payload.cover_path),
    rating:             payload.rating || null,
    date_started:       t(payload.date_started),
    date_finished:      t(payload.date_finished),
    acquisition_source: isCustom ? null : t(payload.acquisition_source),
    acquisition_date:   isCustom ? null : t(payload.acquisition_date),
    format:             payload.format || null,
    binding:            isPhysical ? (payload.binding || null) : null,
    // condition describes the state of YOUR copy, so it requires owning the
    // book. Form clears it on owned-toggle-off (AcquisitionFields.jsx:13).
    condition:          (isPhysical && isOwned) ? (payload.condition || null) : null,
    description:        t(payload.description),
    notes:              t(payload.notes),
    review:             t(payload.review),
    page_count:         isAudiobook ? null : (payload.page_count || null),
    duration_minutes:   isAudiobook ? (payload.duration_minutes || null) : null,
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
    archived:           payload.archived ? 1 : 0,
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
    // on_readlist isn't in BOOK_TABLE_COLUMNS because it carries a side
    // effect — assigning the next readlist_position. Mirror what patchBook
    // does so a single POST can enroll a wishlist item.
    if (payload.on_readlist) {
      const max = db.prepare('SELECT MAX(readlist_position) as m FROM books WHERE on_readlist = 1').get();
      db.prepare('UPDATE books SET on_readlist = 1, readlist_position = ? WHERE id = ?')
        .run((max.m ?? -1) + 1, newId);
    }
    return newId;
  })();
  return getBook(id);
}

export function updateBook(id, payload) {
  const existing = db.prepare('SELECT cover_path, status, read_count, rating, review, work_id FROM books WHERE id = ?').get(id);
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

  // Defensive cover handling. Three cases:
  //   1. Field absent from payload   → preserve existing (don't touch the file)
  //   2. Explicit null / empty       → user is clearing the cover; null + delete
  //   3. Malformed path               → preserve existing (silent destruction
  //      was the bug class that nuked legacy .jpg covers when the regex was tightened)
  // Case 1 separation matters because a scripted PUT roundtrip that omits
  // cover_path used to silently null the field AND deleteLocalCover() the
  // underlying file — both irreversibly. The form-based UI always sends
  // cover_path, so case 1 is exclusively the API/script path.
  const coverInPayload = Object.prototype.hasOwnProperty.call(payload, 'cover_path');
  const newCoverFilename = coverInPayload ? toFilename(payload.cover_path) : existing.cover_path;
  const userSentMalformed = coverInPayload && payload.cover_path != null && payload.cover_path !== '' && newCoverFilename === null;
  const effectiveCoverPath = userSentMalformed ? existing.cover_path : newCoverFilename;
  const shouldDeleteOldFile = coverInPayload && !userSentMalformed && existing.cover_path !== newCoverFilename;

  db.transaction(() => {
    db.prepare(`UPDATE books SET ${BOOK_UPDATE_COLS}, read_count = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(...bookValues(payload, { is_stub: effectiveIsStub, cover_path: effectiveCoverPath }), newReadCount, id);
    // On finish-transition, capture this completion as a `reads` row so the
    // per-completion history stays in sync. Even if the same PUT also bumps
    // read_count to N (e.g. backfilling a never-tracked re-read total on
    // first finish), only THIS completion is logged explicitly — the rest
    // live in read_count, per the decoupling rule above.
    if (isFinishTransition) {
      db.prepare(`
        INSERT INTO reads (book_id, date_started, date_finished, created_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
      `).run(id, t(payload.date_started), t(payload.date_finished));
    }
    if (tags        !== undefined) syncTags(id, tags);
    if (narrators   !== undefined) syncNarrators(id, narrators);
    if (authors     !== undefined) syncAuthors(id, authors);
    if (translators !== undefined) syncTranslators(id, translators);
    // No edition propagation. Rating, review, and read_count are
    // properties of THIS edition — a translation's quality, an audio
    // narrator, the act of finishing this specific copy. Each sibling
    // owns its own state. EditionsSection surfaces siblings' ratings
    // and read counts so the user can see at a glance what they've
    // done in other editions of the same work.
  })();

  if (shouldDeleteOldFile) deleteLocalCover(existing.cover_path);
  return getBook(id);
}

export function patchBook(id, patch) {
  const existing = db.prepare('SELECT id, current_page, current_minutes FROM books WHERE id = ?').get(id);
  if (!existing) return null;

  const { current_page, current_minutes, loved, on_readlist, is_stub, fiction, acquisition_source, description, archived } = patch;

  const fields = [];
  const params = [];
  // No-op progress patches (re-submitting the same value the form was
  // pre-filled with) used to fall through and rewrite updated_at, which
  // bumped the book to the top of recency-sorted views without any actual
  // change. Drop them from the field list so the UPDATE itself doesn't run.
  if (current_page    !== undefined && (current_page    ?? null) !== (existing.current_page    ?? null)) {
    fields.push('current_page = ?');    params.push(current_page    ?? null);
  }
  if (current_minutes !== undefined && (current_minutes ?? null) !== (existing.current_minutes ?? null)) {
    fields.push('current_minutes = ?'); params.push(current_minutes ?? null);
  }
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
  // Archiving is a forward-looking decision ("hide from active library"), so
  // it implies removing from the readlist (which is also forward-looking).
  // Loved, shelf assignment, and list memberships are passive metadata and
  // stay intact so un-archiving restores the book to its prior state.
  if (archived !== undefined) {
    fields.push('archived = ?');
    params.push(archived ? 1 : 0);
    if (archived) {
      fields.push('on_readlist = ?');     params.push(0);
      fields.push('readlist_position = ?'); params.push(null);
    }
  }

  const pagesLogged   = (current_page    !== undefined && current_page    > (existing.current_page    ?? 0)) ? current_page    - (existing.current_page    ?? 0) : 0;
  const minutesLogged = (current_minutes !== undefined && current_minutes > (existing.current_minutes ?? 0)) ? current_minutes - (existing.current_minutes ?? 0) : 0;

  db.transaction(() => {
    if (fields.length) {
      db.prepare(`UPDATE books SET ${fields.join(', ')}, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(...params, id);
    }
    if (pagesLogged > 0 || minutesLogged > 0) {
      // story_id defaults to NULL — book-level row, targets the partial
      // unique index on (book_id, date) WHERE story_id IS NULL.
      db.prepare(`
        INSERT INTO reading_log (book_id, date, pages_read, minutes_read)
        VALUES (?, date('now', 'localtime'), ?, ?)
        ON CONFLICT(book_id, date) WHERE story_id IS NULL DO UPDATE SET
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
