import express from 'express';
import db from '../db.js';
import { validateBook, isValidDate, isValidPartialDate, partialDateBefore } from '../lib/books/validation.js';
import { getBook, getBookCounts, getBookFacets, listBooks, createBook, updateBook, patchBook, deleteBook, updateBookCover, linkEditions, unlinkEdition, findDuplicateRead } from '../lib/books/repository.js';
import { syncStoryAuthors, pruneOrphanPeople } from '../lib/books/people.js';
import { buildFilterConditions } from '../lib/books/filters.js';
import { ENUM_VALUES } from '../shared/bookFields.js';
import { downloadCoverByUrl, CoverFetchError, deleteLocalCover } from '../lib/books/covers.js';
import { findDuplicateClusters, mergeBooks } from '../lib/books/duplicates.js';
import { t } from '../lib/books/normalization.js';

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

// Manual rank for the Library "Never owned" tab. Mirrors the readlist
// reorder route's shape: caller sends ids in display order, server writes
// the index back as desire_rank. We don't gate on "is never_owned" — a
// stale rank on a book that's since become owned is harmless because the
// 'custom' sort is only ever surfaced on the Never owned tab.
router.put('/desire-order', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.every(id => Number.isInteger(id) && id >= 1)) {
    return res.status(400).json({ error: 'ids must be an array of positive integers' });
  }
  const update = db.prepare('UPDATE books SET desire_rank = ? WHERE id = ?');
  db.transaction(() => {
    ids.forEach((id, i) => update.run(i, id));
  })();
  res.json({ ok: true });
});

// Random book — backs the `R` shortcut. Must sit above the /:id route
// so "random" isn't read as a numeric id. Accepts the same filter
// query params as GET /books (tab, statuses, archived, owned, …) so a
// random pick from /?tab=reading lands on a random reading book; the
// shortcut respects whatever filter view the user is on. Archived
// books are excluded by default (the buildFilterConditions helper
// applies that rule, with the same exceptions: tab='archived' opts
// in; archived='any' includes both).
router.get('/random', (req, res) => {
  const { conditions, params } = buildFilterConditions(req.query);
  // Random pick is "show me a book from my library" — a wishlist
  // placeholder isn't readable yet, so it's not a useful suggestion.
  // Always exclude, regardless of the filter view the caller is on.
  conditions.push("COALESCE(is_stub,0) = 0");
  const where = `WHERE ${conditions.join(' AND ')}`;
  const row = db.prepare(`SELECT id FROM books ${where} ORDER BY RANDOM() LIMIT 1`).get(...params);
  if (!row) return res.status(404).json({ error: 'No matching books' });
  res.json({ id: row.id });
});

// Unresolved duplicate / edition clusters (same normalised title +
// author set, not all linked into one work group). Backs the Audit
// duplicates wizard. Must sit above /:id like /random.
router.get('/duplicate-clusters', (_req, res) => {
  res.json(findDuplicateClusters());
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
  const { date_started, date_finished, did_not_finish } = req.body;
  if (date_started && !isValidPartialDate(date_started)) return res.status(400).json({ error: 'Invalid date_started' });
  if (date_finished && !isValidPartialDate(date_finished)) return res.status(400).json({ error: 'Invalid date_finished' });
  if (date_started && date_finished && partialDateBefore(date_finished, date_started)) return res.status(400).json({ error: 'date_finished cannot be before date_started' });
  const dnf = did_not_finish ? 1 : 0;
  // Idempotency guard: an identical completion (same dates, NULL-safe)
  // returns the existing row with 200 instead of stacking a duplicate.
  // Deliberate duplicates (two undated re-listens) pass allow_duplicate.
  if (!req.body.allow_duplicate) {
    const dup = findDuplicateRead(id, date_started || null, date_finished || null, dnf);
    if (dup) return res.status(200).json(dup);
  }
  const result = db.prepare("INSERT INTO reads (book_id, date_started, date_finished, did_not_finish, created_at) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))")
    .run(id, date_started || null, date_finished || null, dnf);
  res.status(201).json(db.prepare('SELECT * FROM reads WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id/reads/:readId', (req, res) => {
  const id = Number(req.params.id);
  const readId = Number(req.params.readId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(readId) || readId < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM reads WHERE id = ? AND book_id = ?').get(readId, id)) return res.status(404).json({ error: 'Not found' });
  const { date_started, date_finished, did_not_finish } = req.body;
  if (date_started && !isValidPartialDate(date_started)) return res.status(400).json({ error: 'Invalid date_started' });
  if (date_finished && !isValidPartialDate(date_finished)) return res.status(400).json({ error: 'Invalid date_finished' });
  if (date_started && date_finished && partialDateBefore(date_finished, date_started)) return res.status(400).json({ error: 'date_finished cannot be before date_started' });
  const dnf = did_not_finish ? 1 : 0;
  db.prepare('UPDATE reads SET date_started = ?, date_finished = ?, did_not_finish = ? WHERE id = ?')
    .run(date_started || null, date_finished || null, dnf, readId);
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

// ── Stories: per-collection table-of-contents tracking ──────────────────────
// Each story belongs to a parent book and carries its own status / rating
// / date_finished / DNF flag, so the user can mark "I read 'Hour of the
// Dragon'" without touching the rest of a Conan collection. Stories also
// carry a page range (page_start / page_end), an optional per-story
// author override (the story_authors join table; falls back to the book's
// authors when empty), and a year_published. Finishing a story writes a
// story-attributed reading_log row, bumps the parent's current_page, and
// — when every sibling is accounted for — auto-rolls the parent book to
// status='finished'. See migrations 049–052.
const STORY_STATUSES = new Set(['unread', 'reading', 'finished']);

// Empty-string from a cleared form input means "no value" — coerce to
// null before validation so position='' / rating='' don't masquerade as 0.
// (page_start / page_end / year_published already handled this inline; we
// now treat the rest the same way.)
const isBlank = v => v == null || v === '';

function validateStory(body) {
  const errors = [];
  if (!body.title?.trim()) errors.push('Title is required');
  if (body.title && body.title.trim().length > 500) errors.push('Title too long');
  if (body.status && !STORY_STATUSES.has(body.status.trim())) errors.push('Invalid status');
  if (!isBlank(body.rating) && (Number(body.rating) < 0.5 || Number(body.rating) > 5 || (Number(body.rating) * 2) % 1 !== 0)) errors.push('Rating must be 0.5–5 in half-star increments');
  if (body.date_finished && !isValidPartialDate(String(body.date_finished).trim())) errors.push('Invalid date_finished');
  if (!isBlank(body.position) && !Number.isInteger(Number(body.position))) errors.push('Position must be an integer');
  if (!isBlank(body.page_start) && (!Number.isInteger(Number(body.page_start)) || Number(body.page_start) < 1)) errors.push('page_start must be a positive integer');
  if (!isBlank(body.page_end)   && (!Number.isInteger(Number(body.page_end))   || Number(body.page_end)   < 1)) errors.push('page_end must be a positive integer');
  if (!isBlank(body.page_start) && !isBlank(body.page_end) && Number(body.page_end) < Number(body.page_start)) errors.push('page_end cannot be before page_start');
  // Mirrors books.year_published validation in lib/books/validation.js: any
  // non-zero integer (negative for BC works).
  if (!isBlank(body.year_published) && (!Number.isInteger(Number(body.year_published)) || Number(body.year_published) === 0)) errors.push('Invalid publication year');
  return errors;
}

function storyValues(body) {
  return {
    // t() rather than bare trim so story titles fold exotic hyphens and
    // unwrap quotes the same way book titles do.
    title:          t(body.title),
    position:       isBlank(body.position)       ? null : Number(body.position),
    status:         body.status?.trim() || 'unread',
    date_finished:  body.date_finished?.trim() || null,
    rating:         isBlank(body.rating)         ? null : Number(body.rating),
    did_not_finish: body.did_not_finish ? 1 : 0,
    notes:          body.notes?.trim() || null,
    page_start:     isBlank(body.page_start)     ? null : Number(body.page_start),
    page_end:       isBlank(body.page_end)       ? null : Number(body.page_end),
    year_published: isBlank(body.year_published) ? null : Number(body.year_published),
  };
}

// Story-finish writes a reading_log row attributed to the story, and bumps
// books.current_page to MAX(current_page, page_end) so the parent book's
// progress reflects cherry-picked story reads. Idempotent: same story
// finished twice on the same day collapses to one row via the partial
// unique index. pages_read derives from the page range when known; for
// audiobook collections (no ranges) we still write a zero-page row so the
// finish event surfaces in the diary and counts toward day streaks.
function logStoryFinish(book_id, story) {
  if (!story) return;
  const pages = (story.page_start != null && story.page_end != null)
    ? Math.max(0, story.page_end - story.page_start + 1)
    : 0;
  // reading_log.date is consumed by streaks, year filters (LIKE 'YYYY-%'),
  // and date('now', '-N days') comparisons — all of which assume a full
  // ISO YYYY-MM-DD. Story-level date_finished accepts partial dates
  // ('2024' / '2024-06') for finishes recalled long after the fact, so
  // we fall back to today's date unless the value is a full ISO. A
  // story-finish event with a partial date still gets a diary entry —
  // attributed to today rather than dropped.
  const trimmed = story.date_finished?.trim();
  const date = (trimmed && isValidDate(trimmed))
    ? trimmed
    : db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  db.prepare(`
    INSERT OR IGNORE INTO reading_log (book_id, story_id, date, pages_read, minutes_read)
    VALUES (?, ?, ?, ?, 0)
  `).run(book_id, story.id, date, pages);
  if (story.page_end != null) {
    db.prepare('UPDATE books SET current_page = MAX(COALESCE(current_page, 0), ?) WHERE id = ?')
      .run(story.page_end, book_id);
  }
}

// Parent collection auto-rolls to status='finished' when every story is
// accounted for (status='finished' OR did_not_finish=1).
// "Accounted" includes DNF because the user is done with that story —
// either path closes the book out. Idempotent: a parent already in the
// 'finished' state is a no-op, so re-firing on every story write is safe.
//
// Mirrors the finish-transition machinery in updateBook(): bumps
// read_count, inserts a reads row, sets date_finished, advances
// current_page / current_minutes to their respective totals when
// known. Books without any stories are unaffected.
//
// Returns true when the auto-roll fired this call, so route handlers can
// surface that to the client (rating prompt, etc.).
function maybeAutoRollParent(book_id) {
  const book = db.prepare('SELECT status, page_count, duration_minutes FROM books WHERE id = ?').get(book_id);
  if (!book || book.status === 'finished') return false;
  const c = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'finished' OR did_not_finish = 1 THEN 1 ELSE 0 END) AS accounted
    FROM stories WHERE book_id = ?
  `).get(book_id);
  if (!c.total || c.total !== c.accounted) return false;
  // Phase 3: books.date_finished is gone — the finish date lives only
  // on the reads row inserted just below. No duplicate guard here: the
  // roll early-returns when the parent is already finished, so it can
  // only re-fire after a deliberate parent revert + story re-finish —
  // a genuine re-read, even same-day.
  db.prepare(`
    UPDATE books
       SET status        = 'finished',
           read_count    = read_count + 1,
           current_page    = CASE WHEN page_count       IS NOT NULL THEN page_count       ELSE current_page    END,
           current_minutes = CASE WHEN duration_minutes IS NOT NULL THEN duration_minutes ELSE current_minutes END,
           updated_at    = datetime('now', 'localtime')
     WHERE id = ?
  `).run(book_id);
  db.prepare(`
    INSERT INTO reads (book_id, date_started, date_finished, created_at)
    VALUES (?, NULL, date('now', 'localtime'), datetime('now', 'localtime'))
  `).run(book_id);
  return true;
}

function getStoryWithAuthors(storyId) {
  const s = db.prepare('SELECT * FROM stories WHERE id = ?').get(storyId);
  if (!s) return null;
  s.authors = db.prepare(`
    SELECT a.id, a.name FROM authors a
    JOIN story_authors sa ON sa.author_id = a.id
    WHERE sa.story_id = ?
    ORDER BY sa.position
  `).all(storyId);
  return s;
}

router.get('/:id/stories', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  // NULL position sorts last so unpositioned stories collect at the end of
  // the contents list instead of mixing into the middle.
  const rows = db.prepare(
    'SELECT * FROM stories WHERE book_id = ? ORDER BY COALESCE(position, 9999999) ASC, id ASC'
  ).all(id);
  // Per-story authors (Layer 2). Empty array means "no override" — the
  // caller renders the parent book's authors as fallback.
  const ids = rows.map(r => r.id);
  const authorMap = new Map(ids.map(id => [id, []]));
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    db.prepare(`
      SELECT sa.story_id, a.id, a.name FROM authors a
      JOIN story_authors sa ON sa.author_id = a.id
      WHERE sa.story_id IN (${ph})
      ORDER BY sa.position
    `).all(...ids).forEach(({ story_id, id, name }) => authorMap.get(story_id)?.push({ id, name }));
  }
  res.json(rows.map(r => ({ ...r, authors: authorMap.get(r.id) })));
});

router.post('/:id/stories', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(id)) return res.status(404).json({ error: 'Not found' });
  const errors = validateStory(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });
  const v = storyValues(req.body);
  // A new story counts as transitioning to "accounted" iff it's created
  // already in that state. Without this gate, *any* POST after the user
  // manually reverted a finished parent (to re-read or fix metadata)
  // would re-roll the parent on the next note edit / story add.
  const accountedNow = v.status === 'finished' || v.did_not_finish === 1;
  const result = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO stories (book_id, title, position, status, date_finished, rating, did_not_finish, notes, page_start, page_end, year_published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `).run(id, v.title, v.position, v.status, v.date_finished, v.rating, v.did_not_finish, v.notes, v.page_start, v.page_end, v.year_published);
    if (req.body.authors !== undefined) syncStoryAuthors(r.lastInsertRowid, req.body.authors);
    if (v.status === 'finished') {
      logStoryFinish(id, { id: r.lastInsertRowid, page_start: v.page_start, page_end: v.page_end, date_finished: v.date_finished });
    }
    const parentAutoFinished = accountedNow ? maybeAutoRollParent(id) : false;
    return { storyId: r.lastInsertRowid, parentAutoFinished };
  })();
  res.status(201).json({ ...getStoryWithAuthors(result.storyId), parent_auto_finished: result.parentAutoFinished });
});

router.put('/:id/stories/:storyId', (req, res) => {
  const id = Number(req.params.id);
  const storyId = Number(req.params.storyId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(storyId) || storyId < 1) return res.status(400).json({ error: 'Invalid id' });
  const existing = db.prepare('SELECT id, status, did_not_finish FROM stories WHERE id = ? AND book_id = ?').get(storyId, id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const errors = validateStory(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });
  const v = storyValues(req.body);
  // Snapshot the transitions once. A story going from anything-else to
  // 'finished' triggers reading_log + current_page bump on the parent.
  // Re-saving an already-finished story (e.g. fixing a typo) does not.
  const finishing = v.status === 'finished' && existing.status !== 'finished';
  // The parent auto-roll fires only when *this* PUT moves the story
  // from unaccounted to accounted (status='finished' OR did_not_finish=1).
  // Without this gate, saving a note on an already-finished story after
  // the user manually reverted the parent (to re-read or fix metadata)
  // would silently re-roll the parent and bump read_count.
  const wasAccounted = existing.status === 'finished' || existing.did_not_finish === 1;
  const isAccounted  = v.status === 'finished' || v.did_not_finish === 1;
  const accountedTransition = !wasAccounted && isAccounted;
  const result = db.transaction(() => {
    db.prepare(`
      UPDATE stories
         SET title = ?, position = ?, status = ?, date_finished = ?, rating = ?, did_not_finish = ?, notes = ?, page_start = ?, page_end = ?, year_published = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?
    `).run(v.title, v.position, v.status, v.date_finished, v.rating, v.did_not_finish, v.notes, v.page_start, v.page_end, v.year_published, storyId);
    if (req.body.authors !== undefined) syncStoryAuthors(storyId, req.body.authors);
    if (finishing) {
      logStoryFinish(id, { id: storyId, page_start: v.page_start, page_end: v.page_end, date_finished: v.date_finished });
    }
    const parentAutoFinished = accountedTransition ? maybeAutoRollParent(id) : false;
    return { parentAutoFinished };
  })();
  res.json({ ...getStoryWithAuthors(storyId), parent_auto_finished: result.parentAutoFinished });
});

router.delete('/:id/stories/:storyId', (req, res) => {
  const id = Number(req.params.id);
  const storyId = Number(req.params.storyId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(storyId) || storyId < 1) return res.status(400).json({ error: 'Invalid id' });
  if (!db.prepare('SELECT id FROM stories WHERE id = ? AND book_id = ?').get(storyId, id)) return res.status(404).json({ error: 'Not found' });
  // Removing a story can be the act that completes the collection — e.g.
  // four siblings finished, an erroneous fifth deleted, parent should
  // roll. Symmetric to the POST/PUT auto-roll path. The function's own
  // guards keep this safe: zero remaining stories returns false (matches
  // the books-without-stories rule), already-finished parent returns
  // false (no double-roll).
  db.transaction(() => {
    db.prepare('DELETE FROM stories WHERE id = ?').run(storyId);
    // story_authors cascades on the stories delete; the author rows
    // themselves may now be orphaned if this was their last credit.
    pruneOrphanPeople('authors');
    maybeAutoRollParent(id);
  })();
  res.status(204).send();
});

router.post('/', (req, res) => {
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0].message, field: errors[0].field });
  res.status(201).json(createBook(req.body));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const errors = validateBook(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0].message, field: errors[0].field });
  const book = updateBook(id, req.body);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const { current_page, current_minutes } = req.body;
  // Fetch the book's bounds upfront so progress saves can't claim 110% of a
  // 240-page book — common finger-fumble (typing pages-remaining instead of
  // pages-read; pasting from a different book's note). Only bound when the
  // book has a known page_count / duration_minutes; null means unknown and
  // any non-negative value is accepted.
  let bounds = null;
  if (current_page != null || current_minutes != null) {
    bounds = db.prepare('SELECT page_count, duration_minutes FROM books WHERE id = ?').get(id);
    if (!bounds) return res.status(404).json({ error: 'Not found' });
  }
  if (current_page != null) {
    const n = Number(current_page);
    if (current_page === '' || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'Invalid page number' });
    if (bounds.page_count != null && n > bounds.page_count) {
      return res.status(400).json({ error: `current_page cannot exceed page_count (${bounds.page_count})` });
    }
    req.body.current_page = n;
  }
  if (current_minutes != null) {
    const n = Number(current_minutes);
    if (current_minutes === '' || !Number.isInteger(n) || n < 0) return res.status(400).json({ error: 'Invalid minutes' });
    if (bounds.duration_minutes != null && n > bounds.duration_minutes) {
      return res.status(400).json({ error: `current_minutes cannot exceed duration_minutes (${bounds.duration_minutes})` });
    }
    req.body.current_minutes = n;
  }
  // Enum-validate binding when present. Empty string / null clears the
  // field; any other value must be in the binding enum. Caller is trusted
  // to only patch this on physical books (the audit wizard does so; other
  // callers can validate their own format gating).
  if (req.body.binding !== undefined && req.body.binding !== null && req.body.binding !== '') {
    if (!ENUM_VALUES.binding.includes(req.body.binding)) {
      return res.status(400).json({ error: 'Invalid binding' });
    }
  }
  // Same shape for format. Note: PATCH'ing format doesn't clear
  // format-specific fields (binding, narrator, duration, shelf_id).
  // Safe in the audit-wizard case because the pool is books with
  // format IS NULL — there's no existing format-specific data to
  // inconsistency. Other callers should use PUT for a format-change
  // workflow that needs to clean up.
  if (req.body.format !== undefined && req.body.format !== null && req.body.format !== '') {
    if (!ENUM_VALUES.format.includes(req.body.format)) {
      return res.status(400).json({ error: 'Invalid format' });
    }
  }
  if (req.body.condition !== undefined && req.body.condition !== null && req.body.condition !== '') {
    if (!ENUM_VALUES.condition.includes(req.body.condition)) {
      return res.status(400).json({ error: 'Invalid condition' });
    }
  }
  // Rating: 0.5–5 in 0.5-step increments, or null/empty to clear.
  // The DB has a CHECK constraint matching the same shape (see
  // migration 053); validating here gives a friendlier error and
  // matches the half-stars-everywhere convention in feedback memory.
  if (req.body.rating !== undefined && req.body.rating !== null && req.body.rating !== '') {
    const r = Number(req.body.rating);
    if (Number.isNaN(r) || r < 0.5 || r > 5 || (r * 2) % 1 !== 0) {
      return res.status(400).json({ error: 'Invalid rating' });
    }
    req.body.rating = r;
  }
  // ISBN columns share validateBook's regex shape so a PATCH writes
  // exactly what a full PUT would. Caller picks the right column based
  // on length (the wizard does this client-side). Hyphens / spaces are
  // accepted on input and stripped before length-checking, since
  // ISBN-10s are conventionally typed as "0-471-12345-X" etc.
  for (const col of ['isbn_10', 'isbn_13']) {
    if (req.body[col] !== undefined && req.body[col] !== null && req.body[col] !== '') {
      const stripped = String(req.body[col]).replace(/[-\s]/g, '');
      const ok = col === 'isbn_10' ? /^\d{9}[\dX]$/.test(stripped) : /^\d{13}$/.test(stripped);
      if (!ok) return res.status(400).json({ error: `Invalid ${col.replace('_', '-').toUpperCase()}` });
      req.body[col] = stripped;
    }
  }
  // Partial-date fields share the YYYY / YYYY-MM / YYYY-MM-DD shape
  // (server's isValidPartialDate). Empty / null clears. Mirrors validateBook —
  // the book row's start/finish dates accept partials so the rule is uniform
  // across reads / stories / acquisition_date.
  for (const col of ['acquisition_date', 'date_started', 'date_finished']) {
    if (req.body[col] !== undefined && req.body[col] !== null && req.body[col] !== '') {
      const trimmed = String(req.body[col]).trim();
      if (!isValidPartialDate(trimmed)) {
        return res.status(400).json({ error: `Invalid ${col} — must be YYYY, YYYY-MM, or YYYY-MM-DD` });
      }
      req.body[col] = trimmed;
    }
  }
  // Number fields. Validation mirrors validateBook (PUT path) so PATCH
  // can't sneak in shapes a PUT would reject. year_* allow negatives
  // (BCE) but reject 0 (no year zero in BC/AD convention). page_count
  // / duration_minutes must be positive integers. series_number is
  // numeric (BookForm UI restricts to 0.5 steps, but the column
  // accepts any number — wizard does the same).
  for (const col of ['year_published', 'year_edition']) {
    if (req.body[col] !== undefined && req.body[col] !== null && req.body[col] !== '') {
      const n = Number(req.body[col]);
      if (!Number.isInteger(n) || n === 0) {
        return res.status(400).json({ error: `Invalid ${col} — must be a non-zero integer (negatives are BCE)` });
      }
      req.body[col] = n;
    }
  }
  for (const col of ['page_count', 'duration_minutes']) {
    if (req.body[col] !== undefined && req.body[col] !== null && req.body[col] !== '') {
      const n = Number(req.body[col]);
      if (!Number.isInteger(n) || n < 1) {
        return res.status(400).json({ error: `Invalid ${col} — must be a positive integer` });
      }
      req.body[col] = n;
    }
  }
  if (req.body.title !== undefined && (req.body.title == null || !String(req.body.title).trim())) {
    return res.status(400).json({ error: 'Title cannot be empty' });
  }
  if (req.body.status !== undefined && req.body.status !== null && req.body.status !== '') {
    if (!ENUM_VALUES.status.includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
  }
  // source_type is non-fiction-only (mirrors validation.js for POST/PUT).
  // Patches that set source_type must also leave the book on fiction=0
  // (either by patching fiction:false here, or the book is already
  // non-fiction). Enum-check the value first; then gate on effective
  // fiction by reading the existing row when fiction isn't in the patch.
  if (req.body.source_type !== undefined && req.body.source_type !== null && req.body.source_type !== '') {
    if (!ENUM_VALUES.source_type.includes(req.body.source_type)) {
      return res.status(400).json({ error: 'Invalid source_type' });
    }
    const incomingFiction = req.body.fiction;
    let effectiveFiction;
    if (incomingFiction !== undefined) {
      effectiveFiction = (incomingFiction === false || incomingFiction === 0 || incomingFiction === '0') ? 0 : 1;
    } else {
      const row = db.prepare('SELECT fiction FROM books WHERE id = ?').get(id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      effectiveFiction = row.fiction;
    }
    if (effectiveFiction !== 0) {
      return res.status(400).json({ error: 'source_type requires fiction: false' });
    }
  }
  if (req.body.series_number !== undefined && req.body.series_number !== null && req.body.series_number !== '') {
    const n = Number(req.body.series_number);
    if (Number.isNaN(n)) return res.status(400).json({ error: 'Invalid series_number' });
    // Series numbering is whole or half-volume only — matches BookForm's
    // step="0.5" and the wizard's HTML5 step constraint. Without this the
    // server-side path (curl, scripts, etc.) would silently accept 1.3 / 1.7.
    if ((n * 2) % 1 !== 0) return res.status(400).json({ error: 'series_number must be a multiple of 0.5' });
    req.body.series_number = n;
  }
  // Join-table arrays. Caller passes a list of strings or {name}
  // objects; the syncPeople helper handles both shapes. Empty array
  // clears all rows. Anything else is a client bug. Tags follow the
  // same shape (strings or {name}) and use syncTags.
  for (const col of ['authors', 'narrators', 'translators', 'tags']) {
    if (req.body[col] !== undefined && !Array.isArray(req.body[col])) {
      return res.status(400).json({ error: `${col} must be an array` });
    }
  }
  const book = patchBook(id, req.body);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

// One-shot atomic re-read: bump read_count by 1 and insert a reads row in
// the same transaction. Distinct from a finish-transition (status doesn't
// change here — book is already 'finished' when the user re-reads it), so
// the auto-INSERT path in updateBook doesn't fire and we'd otherwise need
// two client calls (PUT to bump count + POST /reads to log the row) that
// can leave half-applied state on partial failure. See docs/book-model.md
// § "reads rows" for how this fits the broader contract.
router.post('/:id/reread', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const existing = db.prepare('SELECT read_count FROM books WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { date_started, date_finished } = req.body || {};
  if (date_started  && !isValidPartialDate(date_started))  return res.status(400).json({ error: 'Invalid date_started' });
  if (date_finished && !isValidPartialDate(date_finished)) return res.status(400).json({ error: 'Invalid date_finished' });
  if (date_started && date_finished && partialDateBefore(date_finished, date_started)) {
    return res.status(400).json({ error: 'date_finished cannot be before date_started' });
  }
  db.transaction(() => {
    db.prepare("UPDATE books SET read_count = read_count + 1, updated_at = datetime('now', 'localtime') WHERE id = ?").run(id);
    db.prepare("INSERT INTO reads (book_id, date_started, date_finished, created_at) VALUES (?, ?, ?, datetime('now', 'localtime'))")
      .run(id, date_started || null, date_finished || null);
  })();
  res.json(getBook(id));
});

// Cross-edition linking. Two books that share a non-NULL work_id are
// alternate editions of the same underlying work; the relationship is
// symmetric (every member sees every other) and transitive (linking a
// new edition into an existing group joins them all). Linking two books
// already in different groups merges into the lower-id group.
router.post('/:id/work-link', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const otherId = Number(req.body?.other_id);
  if (!Number.isInteger(otherId) || otherId < 1) return res.status(400).json({ error: 'Invalid other_id' });
  if (id === otherId) return res.status(400).json({ error: 'Cannot link a book to itself' });
  const book = linkEditions(id, otherId);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

// Merge a true-duplicate record into this book. :id is the survivor,
// other_id the loser: survivor keeps every field it has, the loser
// fills the blanks, join tables union, reads/log move with dedupe,
// then the loser is deleted. See mergeBooks for the full semantics.
router.post('/:id/merge', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const otherId = Number(req.body?.other_id);
  if (!Number.isInteger(otherId) || otherId < 1) return res.status(400).json({ error: 'Invalid other_id' });
  if (id === otherId) return res.status(400).json({ error: 'Cannot merge a book into itself' });
  const book = mergeBooks(id, otherId);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

// Remove this book from its edition group. The UI ✕-on-sibling action
// also routes through here, called against the sibling's id — clearer
// than a paired endpoint, and the visible effect is the same since the
// row vanishes from every group member's detail page.
router.delete('/:id/work-link', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const book = unlinkEdition(id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  res.json(book);
});

// Combined fetch-URL + set-cover_path. The two-step client flow
// (POST /api/upload/fetch → PATCH /api/books/:id) leaves an orphan file
// on /uploads/ if the PATCH fails after the fetch succeeded (transient
// network hiccup, browser navigation). Doing both server-side closes
// that gap: the only remaining failure window is between saving the
// file and running the UPDATE, which we backstop with deleteLocalCover
// on the just-saved file. Used by the cover wizard's commitCandidate.
router.post('/:id/cover/url', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid book id' });
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!url) return res.status(400).json({ error: 'url is required' });
  let filename;
  try {
    filename = await downloadCoverByUrl(url);
  } catch (err) {
    if (err instanceof CoverFetchError) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Failed to fetch cover' });
  }
  try {
    const book = patchBook(id, { cover_path: `/uploads/${filename}` });
    if (!book) {
      // Book vanished between the fetch and the patch (extremely rare,
      // but the file is now an orphan if we don't clean up).
      deleteLocalCover(filename);
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(book);
  } catch (err) {
    deleteLocalCover(filename);
    res.status(500).json({ error: err?.message || 'Failed to set cover' });
  }
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
