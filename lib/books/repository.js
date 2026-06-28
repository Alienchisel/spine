import db from '../../db.js';
import { t, tProse, normalizeIsbn, toFilename, toCoverUrl, normalizeBookLocation } from './normalization.js';
import { VIRTUAL_TAG_RULES, appendWhere, buildFilterConditions, buildOrderBy } from './filters.js';
import { syncAuthors, syncNarrators, syncTranslators, pruneOrphanPeople } from './people.js';
import { syncTags, computeVirtualTags, pruneOrphanTags } from './tags.js';
import { deleteLocalCover, fetchCoverBuffer, saveCoverFromBuffer, measureCoverBytes } from './covers.js';
import { LIST_BOOK_SELECT, attachReadAggregates } from './joinedFields.js';
import { BOOK_TABLE_COLUMNS } from '../../shared/bookFields.js';

export function getBook(id) {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  if (!book) return null;
  const tags = db.prepare(`
    SELECT t.id, t.name FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    WHERE bt.book_id = ?
    ORDER BY nrm(t.name)
  `).all(id);
  const narrators = db.prepare(`
    SELECT n.id, n.name FROM narrators n
    JOIN book_narrators bn ON bn.narrator_id = n.id
    WHERE bn.book_id = ?
    ORDER BY bn.position, n.name
  `).all(id);
  const authorRows = db.prepare(`
    SELECT a.id, a.name, a.alias_group_id FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    WHERE ba.book_id = ?
    ORDER BY ba.position
  `).all(id);
  // For each author in an alias group, attach the other members so the
  // client can render "also writes as ..." next to the byline. Each group's
  // siblings are fetched once and reused across authors in the same group.
  const groupIds = [...new Set(authorRows.filter(a => a.alias_group_id != null).map(a => a.alias_group_id))];
  const aliasesByGroup = new Map();
  if (groupIds.length) {
    const ph = groupIds.map(() => '?').join(',');
    db.prepare(`SELECT id, name, alias_group_id FROM authors WHERE alias_group_id IN (${ph}) ORDER BY name`).all(...groupIds)
      .forEach(a => {
        if (!aliasesByGroup.has(a.alias_group_id)) aliasesByGroup.set(a.alias_group_id, []);
        aliasesByGroup.get(a.alias_group_id).push({ id: a.id, name: a.name });
      });
  }
  const authors = authorRows.map(({ id: aid, name, alias_group_id }) => {
    const others = (aliasesByGroup.get(alias_group_id) || []).filter(o => o.id !== aid);
    return others.length ? { id: aid, name, aliases: others } : { id: aid, name };
  });
  const translators = db.prepare(`
    SELECT t.id, t.name FROM translators t
    JOIN book_translators bt ON bt.translator_id = t.id
    WHERE bt.book_id = ?
    ORDER BY bt.position, t.name
  `).all(id);
  // Hide archived siblings when the current book is non-archived — mirrors
  // The editions panel is work-level metadata ("what other editions of this
  // work exist") rather than a library-inventory surface, so it ignores the
  // archived flag — a finished previously-owned edition that's been archived
  // to declutter the active library should still credit the current book
  // with "you've read this work in another form." Archived rows do stay
  // hidden everywhere else by the default-view rule.
  // rating and read_count are surfaced per sibling so EditionsSection
  // can display "5★ · Read 2×" inline, since edition propagation no
  // longer keeps these in sync (each edition owns its own state).
  const editions = book.work_id != null ? db.prepare(`
    SELECT id, title, format, status, date_finished, cover_path, rating, read_count
    FROM books
    WHERE work_id = ? AND id != ?
    ORDER BY date_finished DESC, id ASC
  `).all(book.work_id, id).map(e => ({ ...e, cover_path: toCoverUrl(e.cover_path) })) : [];
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
  const withAgg = attachReadAggregates([book])[0];
  return { ...withAgg, cover_path: toCoverUrl(book.cover_path), tags: [...tags, ...computeVirtualTags(book)], narrators, authors, translators, editions, stories };
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
      SUM(owned = 1 AND COALESCE(archived,0) = 0)            AS owned,
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

  // distColWithEmpty: SELECT DISTINCT already enumerates every value
  // (including NULL and ''), so the prior shape's separate "hasEmpty"
  // LIMIT-1 query per column was redundant — partition the same row set
  // in JS instead. Saves one roundtrip per column.
  const distColWithEmpty = (col) => {
    const rows = db.prepare(`SELECT DISTINCT ${col} AS v FROM books ${where} ORDER BY ${col}`).all(...params).map(r => r.v);
    const hasEmpty = rows.some(v => v == null || v === '');
    const values   = rows.filter(v => v != null && v !== '');
    return { values, hasEmpty };
  };

  const formatsR    = distColWithEmpty('format');
  const publishersR = distColWithEmpty('publisher');
  const seriesR     = distColWithEmpty('series');
  const sourcesR    = distColWithEmpty('acquisition_source');
  // Distinct from `languages` below, which flattens both `language` and
  // `original_language` for the BookForm datalist. The FilterPanel
  // surfaces the two columns as separate Original / Edition sections
  // so each set of chips can partition cleanly without smearing the
  // ~99%-English reading-language column over the translated corpus.
  const origLangsR  = distColWithEmpty('original_language');
  const editLangsR  = distColWithEmpty('language');

  // Ratings sort descending (5 → 0.5), so we can't reuse distColWithEmpty
  // verbatim; same partition trick on the result.
  const ratingRows  = db.prepare(`SELECT DISTINCT rating AS v FROM books ${where} ORDER BY rating DESC`).all(...params).map(r => r.v);
  const ratings     = ratingRows.filter(v => v != null);
  const hasEmptyRating = ratingRows.some(v => v == null);

  const authors     = db.prepare(`SELECT DISTINCT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id IN (SELECT id FROM books ${where}) ORDER BY nrm(a.name)`).all(...params).map(r => r.name);
  const narrators   = db.prepare(`SELECT DISTINCT n.name FROM narrators n JOIN book_narrators bn ON bn.narrator_id = n.id WHERE bn.book_id IN (SELECT id FROM books ${where}) ORDER BY nrm(n.name)`).all(...params).map(r => r.name);
  const translators = db.prepare(`SELECT DISTINCT t.name FROM translators t JOIN book_translators bt ON bt.translator_id = t.id WHERE bt.book_id IN (SELECT id FROM books ${where}) ORDER BY nrm(t.name)`).all(...params).map(r => r.name);
  const langRows    = db.prepare(`SELECT language, original_language FROM books ${where}`).all(...params);
  const languages   = [...new Set(langRows.flatMap(r => [r.language, r.original_language]).filter(Boolean))].sort();

  const realTags    = db.prepare(`SELECT DISTINCT t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (SELECT id FROM books ${where}) ORDER BY nrm(t.name)`).all(...params).map(r => r.name);

  // Pack the N virtual-tag "any row matches?" checks into a single SELECT:
  // each rule becomes MAX(CASE WHEN rule.sql THEN 1 ELSE 0 END). Was N
  // separate LIMIT-1 scans, now one combined scan.
  const vtSelects = VIRTUAL_TAG_RULES.map((rule, i) => `MAX(CASE WHEN ${rule.sql} THEN 1 ELSE 0 END) AS v${i}`).join(', ');
  const vtRow = vtSelects ? (db.prepare(`SELECT ${vtSelects} FROM books ${where}`).get(...params) ?? {}) : {};
  const virtualTags = VIRTUAL_TAG_RULES.filter((_, i) => vtRow[`v${i}`] === 1).map(r => r.name);

  // Default JS String.sort is codepoint-based — accented entries land
  // past 'Z'. Intl.Collator with sensitivity:'base' folds accents and
  // case, matching the SQL-side nrm() ordering on realTags. virtualTags
  // are ASCII (Antique/Long/Vintage…) so they sort fine either way.
  const tagCollator = new Intl.Collator('en', { sensitivity: 'base' });
  const tags        = [...new Set([...realTags, ...virtualTags])].sort(tagCollator.compare);
  const lists       = db.prepare(`SELECT DISTINCT l.name FROM lists l JOIN list_books lb ON lb.list_id = l.id WHERE lb.book_id IN (SELECT id FROM books ${where}) ORDER BY nrm(l.name)`).all(...params).map(r => r.name);

  return {
    formats:    formatsR.values,    hasEmptyFormat:    formatsR.hasEmpty,
    publishers: publishersR.values, hasEmptyPublisher: publishersR.hasEmpty,
    series:     seriesR.values,     hasEmptySeries:    seriesR.hasEmpty,
    sources:    sourcesR.values,    hasEmptySource:    sourcesR.hasEmpty,
    originalLanguages: origLangsR.values, hasEmptyOriginalLanguage: origLangsR.hasEmpty,
    editionLanguages:  editLangsR.values, hasEmptyEditionLanguage:  editLangsR.hasEmpty,
    ratings,                        hasEmptyRating,
    tags,       lists,
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
  const rows  = db.prepare(`SELECT ${LIST_BOOK_SELECT} FROM books ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);

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
    db.prepare(`SELECT bt.book_id, t.id, t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (${ph}) ORDER BY nrm(t.name)`)
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

  const booksRaw = rows.map(b => ({
    ...b,
    cover_path:    toCoverUrl(b.cover_path),
    tags:          [...(tagMap.get(b.id) || []), ...computeVirtualTags(b)],
    authors:       authorMap.get(b.id) || [],
    narrators:     narratorMap.get(b.id) || [],
    translators:   translatorMap.get(b.id) || [],
    current_story: currentStoryMap.get(b.id) || null,
  }));
  const books = attachReadAggregates(booksRaw);

  // Opt-in: surface the unowned count for this filter slice so callers
  // (BrowsePage's "Show unowned (N)" toggle) don't need a second round-trip.
  // Re-runs the filter with `tab` / `status` stripped so the count reflects
  // the unowned subset of the browse target regardless of which tab is
  // currently displayed.
  let unowned_total;
  if (query.counts === 'owned') {
    const { conditions: condNoTab, params: paramsNoTab } = buildFilterConditions({
      ...query,
      tab: undefined,
      status: undefined,
    });
    const whereNoTab = condNoTab.length ? `WHERE ${condNoTab.join(' AND ')}` : '';
    unowned_total = db.prepare(
      `SELECT COUNT(*) as n FROM books ${appendWhere(whereNoTab, 'COALESCE(owned,0) = 0')}`,
    ).get(...paramsNoTab).n;
  }

  return { books, total, offset, limit, ...(unowned_total !== undefined && { unowned_total }) };
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
  // Normalize previously_owned ahead of the return so the acquisition gate
  // below can see the effective value. Custom forces it to 0; otherwise it
  // can only be 1 when the book isn't currently owned (AcquisitionFields
  // mirrors this exclusivity in its owned-checkbox onChange handler).
  const previouslyOwnedNorm = isCustom ? 0 : (!payload.owned && payload.previously_owned ? 1 : 0);
  // Acquisition data is meaningful only for books you currently own or
  // previously owned. AcquisitionFields already hides the inputs via its
  // (form.owned || form.previously_owned) && !form.is_custom gate — so
  // without server-side normalisation, a
  // book toggled from owned to not-previously-owned ends up with orphaned
  // acquisition_source / acquisition_date the user can no longer see or
  // edit through the UI. Same defensive shape as the is_custom rule:
  // server-side null-out, not form-side destructive toggle, so mid-edit
  // state is preserved until the user actually saves.
  const hasOwnership = !isCustom && (!!payload.owned || !!previouslyOwnedNorm);
  return {
    title:              t(payload.title),
    status:             payload.status || 'unread',
    owned:              isCustom ? 1 : (payload.owned ? 1 : 0),
    previously_owned:   previouslyOwnedNorm,
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
    acquisition_source: hasOwnership ? t(payload.acquisition_source) : null,
    acquisition_date:   hasOwnership ? t(payload.acquisition_date) : null,
    format:             payload.format || null,
    binding:            isPhysical ? (payload.binding || null) : null,
    // condition describes the state of YOUR copy, so it requires owning the
    // book. Form clears it on owned-toggle-off (AcquisitionFields.jsx:13).
    condition:          (isPhysical && isOwned) ? (payload.condition || null) : null,
    description:        tProse(payload.description),
    notes:              tProse(payload.notes),
    review:             tProse(payload.review),
    // page_count is allowed on every format — audiobooks track it as the
    // print-equivalent size so cross-format stats (collage, pages-read
    // hero) compare books in one unit instead of the old pages × 2 +
    // minutes composite. User-maintained for audiobooks.
    page_count:         payload.page_count || null,
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
    year_published_approximate: payload.year_published_approximate ? 1 : 0,
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
  // Mirror updateBook's is_stub graduation rule on POST too: a row that
  // will be owned (explicit owned=1 or via is_custom) can't simultaneously
  // be a wishlist placeholder. Without this, POST { is_stub:true, owned:true }
  // would create an inconsistent row. Status is *not* part of the invariant:
  // a user can read a borrowed/digital copy (status=finished), lose access
  // to it, and still want their own copy — the wishlist placeholder is
  // about acquisition state, not reading state.
  const willBeOwned     = !!payload.is_custom || Number(payload.owned) === 1;
  const effectiveIsStub = (payload.is_stub && !willBeOwned) ? 1 : 0;
  const id = db.transaction(() => {
    const result = db.prepare(`INSERT INTO books (${BOOK_INSERT_COLS}, created_at, updated_at) VALUES (${BOOK_PLACEHOLDERS}, datetime('now', 'localtime'), datetime('now', 'localtime'))`).run(...bookValues(payload, { is_stub: effectiveIsStub }));
    const newId = result.lastInsertRowid;
    // System-managed cover_bytes — captured outside BOOK_TABLE_COLUMNS so
    // it stays out of the user-writable surface. measureCoverBytes returns
    // null when the file is absent / unreadable, which matches a NULL
    // cover column and keeps missing=hi_res_cover idempotent.
    const filename = toFilename(payload.cover_path);
    if (filename) {
      db.prepare('UPDATE books SET cover_bytes = ? WHERE id = ?').run(measureCoverBytes(filename), newId);
    }
    if (tags?.length)             syncTags(newId, tags);
    if (narrators   !== undefined) syncNarrators(newId, narrators);
    if (authors     !== undefined) syncAuthors(newId, authors);
    if (translators !== undefined) syncTranslators(newId, translators);
    // Finish-cascade for POST: a book created directly in status='finished'
    // (e.g. backfilling a previously-read import) needs the same read_count
    // bump + reads-row insert that the PATCH/PUT cascades produce on
    // finish-transition. Without it the new row sits in finished state with
    // read_count=0 and no per-completion history, violating the "every
    // finish has a read" invariant. No story propagation — a brand-new
    // book row carries no stories yet. Dates pass through as-supplied
    // (no today auto-fill); the bookColumns write already mirrors that.
    if (payload.status === 'finished') {
      db.prepare('UPDATE books SET read_count = 1 WHERE id = ?').run(newId);
      db.prepare(`
        INSERT INTO reads (book_id, date_started, date_finished, created_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
      `).run(newId, t(payload.date_started), t(payload.date_finished));
    }
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

  const { authors, narrators, translators, tags, title, status, rating, review, is_stub, owned } = payload;
  // Manual override wins; auto-increment on finish transition is the fallback.
  // read_count is authoritative and intentionally decoupled from reads row count.
  // See docs/book-model.md § "Reading data rules" for the full contract.
  const incomingReadCount  = payload.read_count != null ? Number(payload.read_count) : null;
  const isManualReadCount  = incomingReadCount !== null && incomingReadCount !== existing.read_count;
  const isFinishTransition = status === 'finished' && existing.status !== 'finished';
  const newReadCount       = isManualReadCount ? incomingReadCount : existing.read_count + (isFinishTransition ? 1 : 0);
  // is_stub now means "wishlist placeholder" (user wants this edition but
  // doesn't have it yet). Auto-clear when the row will be marked owned —
  // either explicit owned=1 or via is_custom (which forces owned=1 in
  // bookValues). Once you actually hold the book it stops being a
  // wishlist item. Otherwise the flag is user-controlled (no implicit
  // graduation from title/authors presence; an *intentionally* unowned
  // wishlist row stays a wishlist row). Status is *not* part of the
  // invariant — finished + is_stub=1 is the legitimate "I read a borrowed
  // or digital copy, lost access, want my own now" case.
  const willBeOwned        = !!payload.is_custom || Number(owned) === 1;
  const effectiveIsStub    = (is_stub && !willBeOwned) ? 1 : 0;

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
    // Capture cover_bytes whenever the cover_path slot in this UPDATE
    // could have changed — coverInPayload covers both "user supplied a
    // new path" and "user cleared the field." Same idempotent NULL
    // semantics as createBook.
    if (coverInPayload) {
      db.prepare('UPDATE books SET cover_bytes = ? WHERE id = ?')
        .run(effectiveCoverPath ? measureCoverBytes(effectiveCoverPath) : null, id);
    }
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
      // Propagate the finish to any unread stories in this collection. The
      // reverse direction (stories all finished → parent rolls finished) is
      // handled in maybeAutoRollParent; this is the missing forward leg, so
      // marking the parent finished after a linear read-through doesn't
      // leave a TOC of stale 'unread' rows. Skips stories already finished
      // or DNF'd so deliberate per-story state survives. No date_finished
      // backfill — it'd be a fabricated per-story finish moment.
      db.prepare(`
        UPDATE stories
           SET status = 'finished', updated_at = datetime('now', 'localtime')
         WHERE book_id = ? AND status = 'unread' AND COALESCE(did_not_finish, 0) = 0
      `).run(id);
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

// Local YYYY-MM-DD for today. Used as the default date_finished when a PATCH
// transitions status to 'finished' without supplying one. Uses Date getters
// instead of ms arithmetic so DST shifts can't slide the result by a day.
function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function patchBook(id, patch) {
  const existing = db.prepare('SELECT id, current_page, current_minutes, cover_path, status, read_count, date_started, date_finished, owned FROM books WHERE id = ?').get(id);
  if (!existing) return null;

  const { current_page, current_minutes, loved, on_readlist, is_stub, fiction, owned, previously_owned, acquisition_source, description, notes, review, asin, archived, binding, format, condition, rating, publisher, isbn_10, isbn_13, acquisition_date, date_started, date_finished, year_published, year_edition, year_approximate, year_published_approximate, abridged, page_count, duration_minutes, series, series_number, title, original_language, language, source_type, status, authors, narrators, translators, tags, shelf_id, unit_id, room_id, building_id } = patch;

  // Finish-transition cascade — mirrors updateBook (PUT):
  //   * status moves to 'finished' for the first time
  //   * read_count auto-bumps (no manual override path on PATCH; use PUT for that)
  //   * date_finished auto-fills to today if not supplied
  //   * a reads row captures this completion
  // Per the editions-independence rule, no cross-edition propagation.
  const isFinishTransition = status === 'finished' && existing.status !== 'finished';
  const effectiveDateFinished = (isFinishTransition && date_finished === undefined)
    ? todayLocalISO()
    : date_finished;

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
  if (fiction             !== undefined) { fields.push('fiction = ?');             params.push(fiction == null ? null : (fiction ? 1 : 0)); }
  // is_stub / owned coupling: is_stub means "wishlist placeholder." Two
  // cases force is_stub=0: the patch sets owned=1 (graduation on
  // acquisition), or the patch tries to set is_stub=1 while the existing
  // row is already owned. Status is *not* part of the invariant — a user
  // who read a borrowed/digital copy may still want their own copy, so
  // finished + is_stub=1 is allowed. Otherwise the flag is user-controlled.
  const effectiveOwned   = owned !== undefined ? (owned ? 1 : 0) : existing.owned;
  const wouldBeOwned     = effectiveOwned === 1;
  if (is_stub !== undefined || (owned !== undefined && wouldBeOwned)) {
    fields.push('is_stub = ?');
    params.push((wouldBeOwned ? 0 : (is_stub ? 1 : 0)));
  }
  if (owned               !== undefined) { fields.push('owned = ?');               params.push(owned ? 1 : 0); }
  if (previously_owned    !== undefined) { fields.push('previously_owned = ?');    params.push(previously_owned ? 1 : 0); }
  // Location: a book lives at exactly one level (shelf > unit > room >
  // building > nowhere). If the caller touches any of them, normalise to
  // the most specific non-null and clear the others — mirrors the PUT
  // path so PATCH can move a book to a shelf without first PUTting the
  // full record back.
  if (shelf_id !== undefined || unit_id !== undefined || room_id !== undefined || building_id !== undefined) {
    const loc = normalizeBookLocation({ shelf_id, unit_id, room_id, building_id });
    fields.push('shelf_id = ?',    'unit_id = ?',    'room_id = ?',    'building_id = ?');
    params.push(loc.shelf_id, loc.unit_id, loc.room_id, loc.building_id);
  }
  if (acquisition_source  !== undefined) { fields.push('acquisition_source = ?');  params.push(acquisition_source ?? null); }
  if (description         !== undefined) { fields.push('description = ?');         params.push(description ?? null); }
  if (binding             !== undefined) { fields.push('binding = ?');             params.push(binding || null); }
  if (format              !== undefined) { fields.push('format = ?');              params.push(format || null); }
  if (condition           !== undefined) { fields.push('condition = ?');           params.push(condition || null); }
  if (rating              !== undefined) { fields.push('rating = ?');              params.push(rating == null || rating === '' ? null : rating); }
  if (publisher           !== undefined) { fields.push('publisher = ?');           params.push(publisher || null); }
  if (isbn_10             !== undefined) { fields.push('isbn_10 = ?');             params.push(isbn_10 || null); }
  if (isbn_13             !== undefined) { fields.push('isbn_13 = ?');             params.push(isbn_13 || null); }
  if (acquisition_date    !== undefined) { fields.push('acquisition_date = ?');    params.push(acquisition_date || null); }
  if (date_started        !== undefined) { fields.push('date_started = ?');        params.push(date_started || null); }
  if (effectiveDateFinished !== undefined) { fields.push('date_finished = ?'); params.push(effectiveDateFinished || null); }
  if (status              !== undefined) { fields.push('status = ?');              params.push(status || 'unread'); }
  if (isFinishTransition)                { fields.push('read_count = ?');          params.push(existing.read_count + 1); }
  if (year_published      !== undefined) { fields.push('year_published = ?');      params.push(year_published == null || year_published === '' ? null : year_published); }
  if (year_edition        !== undefined) { fields.push('year_edition = ?');        params.push(year_edition == null || year_edition === '' ? null : year_edition); }
  if (page_count          !== undefined) { fields.push('page_count = ?');          params.push(page_count == null || page_count === '' ? null : page_count); }
  if (duration_minutes    !== undefined) { fields.push('duration_minutes = ?');    params.push(duration_minutes == null || duration_minutes === '' ? null : duration_minutes); }
  if (series_number       !== undefined) { fields.push('series_number = ?');       params.push(series_number == null || series_number === '' ? null : series_number); }
  if (title               !== undefined) { fields.push('title = ?');               params.push(t(title)); }
  if (series              !== undefined) { fields.push('series = ?');              params.push(t(series)); }
  if (original_language   !== undefined) { fields.push('original_language = ?');   params.push(t(original_language)); }
  if (language            !== undefined) { fields.push('language = ?');            params.push(t(language)); }
  if (notes               !== undefined) { fields.push('notes = ?');               params.push(tProse(notes)); }
  if (review              !== undefined) { fields.push('review = ?');              params.push(tProse(review)); }
  if (asin                !== undefined) { const a = t(asin); fields.push('asin = ?'); params.push(a ? a.toUpperCase() : null); }
  if (year_approximate            !== undefined) { fields.push('year_approximate = ?');            params.push(year_approximate ? 1 : 0); }
  if (year_published_approximate  !== undefined) { fields.push('year_published_approximate = ?');  params.push(year_published_approximate ? 1 : 0); }
  if (abridged                    !== undefined) { fields.push('abridged = ?');                    params.push(abridged ? 1 : 0); }
  // source_type is non-fiction-only. The route layer validates that the
  // effective fiction value (patch.fiction ?? existing.fiction) is 0
  // before reaching here, so the repo trusts the input. Empty / null clears.
  if (source_type                 !== undefined) { fields.push('source_type = ?');                 params.push(source_type || null); }
  // cover_path mirrors the explicit-clear / file-deletion logic from
  // updateBook (PUT): if the user sends a /uploads/... URL or null/
  // empty, we record the new value and queue the old file for deletion
  // after the transaction commits. Malformed paths leave the column
  // unchanged. See the longer comment in updateBook for the rationale.
  let oldCoverToDelete = null;
  const coverInPatch = Object.prototype.hasOwnProperty.call(patch, 'cover_path');
  if (coverInPatch) {
    const newCoverFilename = toFilename(patch.cover_path);
    const userSentMalformed = patch.cover_path != null && patch.cover_path !== '' && newCoverFilename === null;
    if (!userSentMalformed) {
      if (existing.cover_path !== newCoverFilename) oldCoverToDelete = existing.cover_path;
      fields.push('cover_path = ?');
      params.push(newCoverFilename);
      // Stay in lockstep with cover_path. measureCoverBytes returns null
      // for a missing/unreadable file or an explicit clear (newCoverFilename
      // = null), which matches the NULL we want on the column.
      fields.push('cover_bytes = ?');
      params.push(newCoverFilename ? measureCoverBytes(newCoverFilename) : null);
    }
  }
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
    // Bump updated_at even when only the join-table arrays change, so
    // a person-only PATCH still shows up in recency-sorted views.
    if (fields.length) {
      db.prepare(`UPDATE books SET ${fields.join(', ')}, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(...params, id);
    } else if (authors !== undefined || narrators !== undefined || translators !== undefined || tags !== undefined) {
      db.prepare(`UPDATE books SET updated_at = datetime('now', 'localtime') WHERE id = ?`).run(id);
    }
    if (authors     !== undefined) syncAuthors(id, authors);
    if (narrators   !== undefined) syncNarrators(id, narrators);
    if (translators !== undefined) syncTranslators(id, translators);
    if (tags        !== undefined) syncTags(id, tags);
    // Capture this completion in the reads table on finish-transition.
    // Mirrors updateBook (PUT). date_started falls back to whatever the
    // book already had, so a "mark finished" PATCH after months of
    // progress doesn't drop the start date the user already entered.
    if (isFinishTransition) {
      db.prepare(`
        INSERT INTO reads (book_id, date_started, date_finished, created_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
      `).run(
        id,
        (date_started !== undefined ? t(date_started) : existing.date_started) ?? null,
        effectiveDateFinished ?? null,
      );
      // Mirrors updateBook: propagate the finish to unread stories so the
      // TOC doesn't stay stale when the parent gets marked finished after
      // a linear read. Already-finished / DNF'd stories survive; no
      // per-story date_finished backfill.
      db.prepare(`
        UPDATE stories
           SET status = 'finished', updated_at = datetime('now', 'localtime')
         WHERE book_id = ? AND status = 'unread' AND COALESCE(did_not_finish, 0) = 0
      `).run(id);
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

  // Cover file deletion happens AFTER the transaction so a rollback
  // can't leave us with a deleted file pointing at a still-live row.
  // Mirrors updateBook's deferred deleteLocalCover() call.
  if (oldCoverToDelete) deleteLocalCover(oldCoverToDelete);

  return getBook(id);
}

export function deleteBook(id) {
  const book = db.prepare('SELECT cover_path FROM books WHERE id = ?').get(id);
  if (!book) return false;
  db.transaction(() => {
    // The books cascade removes book_authors / book_narrators /
    // book_translators / book_tags (and indirectly story_authors via the
    // stories cascade). Any rows in the parent people / tags tables whose
    // last association is gone now become orphans — prune them here so
    // the deletion is fully self-contained, matching what the sync*
    // helpers do during a PUT.
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    pruneOrphanPeople('authors');
    pruneOrphanPeople('narrators');
    pruneOrphanPeople('translators');
    pruneOrphanTags();
  })();
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
