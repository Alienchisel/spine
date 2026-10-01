import db from '../../db.js';
import { t, tProse, normalizeIsbn, toFilename, toCoverUrl, normalizeBookLocation } from './normalization.js';
import { VIRTUAL_TAG_RULES, appendWhere, buildFilterConditions, buildOrderBy } from './filters.js';
import { syncAuthors, syncNarrators, syncTranslators, pruneOrphanPeople } from './people.js';
import { syncTags, computeVirtualTags, pruneOrphanTags } from './tags.js';
import { deleteLocalCover, fetchCoverBuffer, saveCoverFromBuffer, measureCoverBytes } from './covers.js';
import { LIST_BOOK_SELECT, attachReadAggregates } from './joinedFields.js';
import { BOOK_TABLE_COLUMNS } from '../../shared/bookFields.js';
import { partialDateBefore } from './validation.js';
import { localToday } from '../../shared/dates.js';

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
  // Edition sibling rows. date_finished surfaces the *latest* finish
  // per edition so the EditionsSection badge reads "Finished · 2025-
  // 06-12" when the user re-read the edition in 2025, not the original
  // first-read date. Ordered by the same date so the sidebar lists
  // editions by recency-of-most-recent-engagement.
  const editions = book.work_id != null ? db.prepare(`
    SELECT b.id, b.title, b.format, b.status, b.cover_path, b.rating, b.read_count,
      (SELECT MAX(date_finished) FROM reads WHERE reads.book_id = b.id) AS date_finished
    FROM books b
    WHERE b.work_id = ? AND b.id != ?
    ORDER BY date_finished DESC, b.id ASC
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
  //
  // COALESCE(SUM(...),0): SUM over zero rows returns NULL, so on a fresh
  // 0-book install every count would come back null and the tab strip
  // would render "null" instead of 0. Floor each to 0.
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(status = 'reading'   AND COALESCE(archived,0) = 0), 0) AS reading,
      COALESCE(SUM(status = 'finished'  AND COALESCE(archived,0) = 0), 0) AS finished,
      COALESCE(SUM(status = 'unread'    AND COALESCE(archived,0) = 0), 0) AS unread,
      COALESCE(SUM(owned = 1 AND COALESCE(archived,0) = 0), 0)            AS owned,
      COALESCE(SUM(previously_owned = 1 AND COALESCE(archived,0) = 0), 0) AS prev_owned,
      COALESCE(SUM(owned = 0 AND COALESCE(previously_owned,0) = 0
                    AND COALESCE(is_custom,0) = 0
                    AND COALESCE(archived,0) = 0), 0)                     AS never_owned,
      COALESCE(SUM(archived = 1), 0)                                      AS archived,
      COALESCE(SUM(COALESCE(archived,0) = 0), 0)                          AS total
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
// Cross-field rules — what a book's ownership, format and fiction flag
// imply for the columns that depend on them. ONE function for every write
// path: bookColumns (POST / PUT) passes the payload, patchBook (PATCH)
// passes the row as it will be after the patch. Before this, PATCH wrote
// each field on its own, so {owned:0} left a shelf location and condition
// behind, {format:'ebook'} left binding / duration / location, and
// {owned:1} on a previously-owned book left both flags set.
//   * Custom collections are always owned and never previously owned.
//   * Owned wins over previously_owned (they're exclusive).
//   * Shelves hold only owned physical books (or format not yet known).
//   * condition describes your copy: owned physical books only.
//   * binding is physical-only; duration_minutes is audiobook-only.
//   * Acquisition data needs current or past ownership (not custom).
//   * source_type classifies non-fiction only (fiction === 0).
// Input values are already normalized (0/1 flags, trimmed strings, a
// normalized location); returns the dependent columns' final values.
function gatedColumns(b) {
  const isCustom    = b.is_custom ? 1 : 0;
  const isOwned     = !!isCustom || !!b.owned;
  const isPhysical  = b.format === 'physical';
  const isShelvable = isOwned && (b.format == null || b.format === 'physical');
  const previouslyOwned = isCustom ? 0 : (!b.owned && b.previously_owned ? 1 : 0);
  const hasOwnership    = !isCustom && (!!b.owned || !!previouslyOwned);
  const fiction = b.fiction == null ? null : (b.fiction ? 1 : 0);
  return {
    owned:              isCustom ? 1 : (b.owned ? 1 : 0),
    previously_owned:   previouslyOwned,
    shelf_id:           isShelvable ? (b.shelf_id    ?? null) : null,
    unit_id:            isShelvable ? (b.unit_id     ?? null) : null,
    room_id:            isShelvable ? (b.room_id     ?? null) : null,
    building_id:        isShelvable ? (b.building_id ?? null) : null,
    condition:          (isPhysical && isOwned) ? (b.condition || null) : null,
    binding:            isPhysical ? (b.binding || null) : null,
    duration_minutes:   b.format === 'audiobook' ? (b.duration_minutes || null) : null,
    acquisition_source: hasOwnership ? (b.acquisition_source ?? null) : null,
    acquisition_date:   hasOwnership ? (b.acquisition_date ?? null) : null,
    source_type:        fiction === 0 ? (b.source_type || null) : null,
  };
}
// Columns gatedColumns decides, plus the inputs it reads — PATCH re-runs
// the rules whenever a patch touches any of them.
const GATE_INPUT_KEYS = ['owned', 'previously_owned', 'format', 'fiction', 'shelf_id', 'unit_id', 'room_id',
  'building_id', 'condition', 'binding', 'duration_minutes', 'acquisition_source', 'acquisition_date', 'source_type'];

function bookColumns(payload, extra = {}) {
  // Custom collections are assembled by the user: always owned, never
  // previously owned, no acquisition data (the form's is_custom toggle
  // does the same; gatedColumns enforces it server-side).
  const isCustom = payload.is_custom ? 1 : 0;
  // Normalize fiction once so the source_type gate reads the same value as
  // the column write. SQLite stores 0/1, so a roundtripped record (GET →
  // PUT) carries integer 0 for non-fiction; a strict `=== false` check
  // would silently drop source_type on that path.
  const fictionNorm = payload.fiction == null ? null : (payload.fiction ? 1 : 0);
  // Ownership / format / fiction consequences (shelf, condition, binding,
  // duration, acquisition data, source_type, the owned / previously_owned
  // exclusivity) come from gatedColumns — the same rules PATCH applies.
  // Server-side null-out rather than a destructive form toggle, so mid-edit
  // state survives until the user actually saves.
  const gated = gatedColumns({
    is_custom: isCustom, owned: payload.owned ? 1 : 0, previously_owned: payload.previously_owned ? 1 : 0,
    format: payload.format || null, fiction: fictionNorm,
    ...normalizeBookLocation(payload),
    condition: payload.condition || null, binding: payload.binding || null,
    duration_minutes: payload.duration_minutes || null,
    acquisition_source: t(payload.acquisition_source), acquisition_date: t(payload.acquisition_date),
    source_type: t(payload.source_type) || null,
  });
  return {
    title:              t(payload.title),
    status:             payload.status || 'unread',
    owned:              gated.owned,
    previously_owned:   gated.previously_owned,
    is_custom:          isCustom,
    is_stub:            extra.is_stub ?? (payload.is_stub ? 1 : 0),
    loved:              payload.loved ? 1 : 0,
    fiction:            fictionNorm,
    // source_type classifies non-fiction works (primary vs secondary). The
    // form clears it unless fiction === false (CoreFields.jsx:64); the
    // backend mirrors that so a direct API call can't tag a fiction or
    // unset-fiction book as primary/secondary.
    source_type:        gated.source_type,
    cover_path:         extra.cover_path !== undefined ? extra.cover_path : toFilename(payload.cover_path),
    rating:             payload.rating || null,
    acquisition_source: gated.acquisition_source,
    acquisition_date:   gated.acquisition_date,
    format:             payload.format || null,
    binding:            gated.binding,
    // condition describes the state of YOUR copy, so it requires owning the
    // book. Form clears it on owned-toggle-off (AcquisitionFields.jsx:13).
    condition:          gated.condition,
    description:        tProse(payload.description),
    notes:              tProse(payload.notes),
    review:             tProse(payload.review),
    // page_count is allowed on every format — audiobooks track it as the
    // print-equivalent size so cross-format stats (collage, pages-read
    // hero) compare books in one unit instead of the old pages × 2 +
    // minutes composite. User-maintained for audiobooks.
    page_count:         payload.page_count || null,
    duration_minutes:   gated.duration_minutes,
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
    shelf_id:           gated.shelf_id,
    building_id:        gated.building_id,
    room_id:            gated.room_id,
    unit_id:            gated.unit_id,
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
  // A new book's dates land on a single reads row.
  assertReadOrder(t(payload.date_started), t(payload.date_finished));
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
    // A supplied read_count (validated by validateBook) is honoured — an
    // import of a book read three times must not land as 1. A finished
    // book counts at least its one completion.
    const suppliedReadCount = payload.read_count != null && payload.read_count !== ''
      ? Number(payload.read_count) : null;
    if (payload.status === 'finished') {
      db.prepare('UPDATE books SET read_count = ? WHERE id = ?').run(Math.max(suppliedReadCount ?? 1, 1), newId);
      db.prepare(`
        INSERT INTO reads (book_id, date_started, date_finished, created_at)
        VALUES (?, ?, ?, datetime('now', 'localtime'))
      `).run(newId, t(payload.date_started), t(payload.date_finished));
    } else {
      // Non-finish POST that still supplies dates (a reading-in-progress
      // import, or an unread row with a target start date) — Phase 3
      // routes those onto a reads row since books.date_started /
      // books.date_finished no longer exist as a fallback storage.
      syncLatestReadsRow(newId, payload);
      if (suppliedReadCount) db.prepare('UPDATE books SET read_count = ? WHERE id = ?').run(suppliedReadCount, newId);
    }
    // on_readlist isn't in BOOK_TABLE_COLUMNS because it carries a side
    // effect — assigning the next readlist_position. Mirror what patchBook
    // does so a single POST can enroll a wishlist item.
    if (payload.on_readlist && !payload.archived) {
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

  const { authors, narrators, translators, tags, status, is_stub, owned } = payload;
  // Manual override wins; auto-increment on finish transition is the fallback.
  // read_count is authoritative and intentionally decoupled from reads row count.
  // See docs/book-model.md § "Reading data rules" for the full contract.
  const incomingReadCount  = payload.read_count != null ? Number(payload.read_count) : null;
  const isManualReadCount  = incomingReadCount !== null && incomingReadCount !== existing.read_count;
  const isFinishTransition = status === 'finished' && existing.status !== 'finished';
  // Reading-session event for a status change (see planReadTransition).
  // PUT carries the book's DISPLAYED date_started / date_finished — the
  // MAX over every read — so an unchanged echo of those is not a date for
  // this session: during a re-read the form still holds the previous
  // read's dates and would stamp them onto the new one. Only a changed
  // value or an explicit clear counts. The finish defaults to today when
  // absent or echoed, matching PATCH. The duplicate guard inside the plan
  // keeps an already-logged completion from stacking a second row;
  // read_count then goes to max(…, 1) rather than skipping, so a book
  // whose read was POSTed first still reaches 1 when flipped to finished.
  const shownDates = (status !== undefined && status !== existing.status)
    ? db.prepare('SELECT MAX(date_started) AS started, MAX(date_finished) AS finished FROM reads WHERE book_id = ?').get(id)
    : null;
  const freshDate = (value, shownValue) => {
    if (value === undefined) return undefined;
    const v = t(value);
    if (v == null) return null;
    return v === shownValue ? undefined : v;
  };
  const suppliedFinish = shownDates ? freshDate(payload.date_finished, shownDates.finished) : undefined;
  const readPlan = planReadTransition(id, existing.status, status, existing.read_count, shownDates ? {
    dateStarted:  freshDate(payload.date_started, shownDates.started),
    dateFinished: suppliedFinish === undefined ? todayLocalISO() : suppliedFinish,
  } : {});
  const newReadCount       = isManualReadCount ? incomingReadCount : readPlan.readCount;
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
    // A status change is a reading-session event: open / resume / close /
    // log the read (planReadTransition). Even if the same PUT also bumps
    // read_count to N (e.g. backfilling a never-tracked re-read total on
    // first finish), only THIS completion is logged explicitly — the rest
    // live in read_count, per the decoupling rule above.
    if (readPlan.kind !== 'none') {
      applyReadTransition(id, readPlan);
    } else {
      // PUT with dates but no status change (already-finished book whose
      // dates are being edited, or a reading book's start date). Phase 3
      // routes those to the latest reads row since books.date_started /
      // date_finished are gone.
      syncLatestReadsRow(id, payload);
    }
    // Archiving is forward-looking ("hide from the active library"), so it
    // takes the book off the readlist — on every write path, not just
    // PATCH. Loved, shelf and list memberships stay, so un-archiving
    // restores the book as it was.
    if (payload.archived) {
      db.prepare('UPDATE books SET on_readlist = 0, readlist_position = NULL WHERE id = ? AND on_readlist = 1').run(id);
    }
    // A re-read starts from page 0 — the previous read's high-water mark
    // would otherwise pin progress at the end (see patchBook's clamp).
    if (readPlan.resetProgress) {
      db.prepare(`
        UPDATE books
           SET current_page    = CASE WHEN current_page    IS NULL THEN NULL ELSE 0 END,
               current_minutes = CASE WHEN current_minutes IS NULL THEN NULL ELSE 0 END
         WHERE id = ?
      `).run(id);
    }
    if (isFinishTransition) {
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
export function todayLocalISO() {
  return localToday();
}

// A read can't finish before it started. Partial dates compare at their
// shared precision (partialDateBefore), so '2024' against '2024-03-01'
// passes. Enforced where both dates land on the SAME reads row — not on
// the book payload, whose date_started / date_finished are the latest
// start and the latest finish and can legitimately come from different
// reads (a re-read in progress shows today's start beside the previous
// read's finish). Throws a 400 carrying `field`, which the app's error
// handler returns so BookForm can jump to the offending tab.
function assertReadOrder(start, finish) {
  if (start && finish && partialDateBefore(finish, start)) {
    const err = new Error('date_finished cannot be before date_started');
    err.status = 400;
    err.field = 'date_finished';
    throw err;
  }
}

// NULL-safe lookup for a reads row that already records this exact
// completion — SQLite's IS operator treats two NULLs as equal, so undated
// rows match undated rows. Guards the finish-cascades and POST /:id/reads:
// re-running a backfill script or re-flipping status to 'finished' must
// not stack identical rows (several books needed manual read dedup during
// the 2026-07-05 Goodreads import before this existed). A deliberate
// same-dates duplicate goes through POST /:id/reads with allow_duplicate.
export function findDuplicateRead(bookId, dateStarted, dateFinished, didNotFinish = 0, excludeId = null) {
  return db.prepare(`
    SELECT * FROM reads
     WHERE book_id = ? AND date_started IS ? AND date_finished IS ?
       AND COALESCE(did_not_finish, 0) = ?
       AND id IS NOT ?
     LIMIT 1
  `).get(bookId, dateStarted ?? null, dateFinished ?? null, didNotFinish ? 1 : 0, excludeId);
}

// ── Reading sessions ───────────────────────────────────────────────────
// A status change is a reading-session event:
//   * into 'reading' starts a session — a reads row with a start date and
//     no finish. Moving back to 'reading' from 'finished' is a RE-READ: it
//     opens a NEW row (today unless a start date is supplied) and resets
//     current_page / current_minutes to 0, so the new read's progress can
//     be logged. Coming from 'unread' resumes a session left open (a
//     reading → unread → reading toggle) instead of starting another.
//   * into 'finished' completes the session: the open row is CLOSED with
//     the finish date; with no open row a completed row is inserted.
//     read_count bumps once per new completion.
// Before this, a status toggle reused the book's aggregate dates (MAX
// over every read, i.e. the previous read's), so a re-read was either
// swallowed by the duplicate guard (read_count stuck, no new read in
// stats) or stamped with the old dates; progress couldn't drop below
// the old high-water mark, so re-entering page 30 snapped back to the
// end and auto-finished; and finishing inserted a second row beside the
// open one instead of closing it.
//
// The open session is the book's most recent reads row when it is
// unfinished and not a DNF — but never on a book that is currently
// 'finished', where an unfinished-looking row is a completed read whose
// finish date was simply never known.
function openReadFor(bookId, fromStatus) {
  if (fromStatus === 'finished') return null;
  const last = db.prepare('SELECT * FROM reads WHERE book_id = ? ORDER BY id DESC LIMIT 1').get(bookId);
  return last && last.date_finished == null && !last.did_not_finish ? last : null;
}

// Decide what a status change does to the reads table without writing
// anything, so callers can fold readCount / resetProgress into their own
// UPDATE and then run applyReadTransition inside their transaction.
// dateStarted / dateFinished: normalized dates, null to clear, or
// undefined for "not supplied". Callers resolve the finish default (today,
// or null for a previously-owned historical read) before calling.
// allowDuplicate skips the already-logged guard — for the story auto-roll,
// which can only re-fire after a deliberate parent revert and so is always
// a genuine re-read, even one finished the same day as the last.
// checkOrder: false skips the finish-before-start check (assertReadOrder)
// for the auto-roll too, so a typo'd future start on the open read can't
// make a story's save fail with an error about the parent book's dates.
export function planReadTransition(bookId, fromStatus, toStatus, readCount, { dateStarted, dateFinished, allowDuplicate = false, checkOrder = true } = {}) {
  if (toStatus === undefined || toStatus === fromStatus) return { kind: 'none', readCount };
  if (toStatus === 'reading') {
    const open = openReadFor(bookId, fromStatus);
    if (open) {
      return { kind: 'resume', readId: open.id, prevStart: open.date_started,
               start: dateStarted ?? open.date_started ?? todayLocalISO(), readCount };
    }
    return { kind: 'start', start: dateStarted ?? todayLocalISO(),
             resetProgress: fromStatus === 'finished' || readCount > 0, readCount };
  }
  if (toStatus === 'finished') {
    const open = openReadFor(bookId, fromStatus);
    const start  = dateStarted !== undefined ? dateStarted : (open?.date_started ?? null);
    const finish = dateFinished ?? null;
    // Closing keeps the open read's start, so an explicit finish earlier
    // than it would write an inverted read — reject before any write.
    if (checkOrder) assertReadOrder(start, finish);
    // Same completion already on file (NULL-safe, ignoring the open row
    // being closed): no second row and no double-bump of read_count. With
    // no session open and no start supplied, a completed read on the same
    // finish date is that completion — the backfill shape, where a read
    // was POSTed first and the book is then flipped to finished.
    const alreadyLogged = !allowDuplicate && !!(
      (!open && dateStarted === undefined)
        ? db.prepare(`
            SELECT 1 FROM reads
             WHERE book_id = ? AND date_finished IS ? AND COALESCE(did_not_finish, 0) = 0
             LIMIT 1
          `).get(bookId, finish)
        : findDuplicateRead(bookId, start, finish, 0, open?.id ?? null));
    return { kind: open ? 'close' : 'insert', readId: open?.id ?? null, start, finish, alreadyLogged,
             readCount: alreadyLogged ? Math.max(readCount, 1) : readCount + 1 };
  }
  return { kind: 'none', readCount };
}

export function applyReadTransition(bookId, plan) {
  switch (plan.kind) {
    case 'start':
      db.prepare(`
        INSERT INTO reads (book_id, date_started, date_finished, created_at)
        VALUES (?, ?, NULL, datetime('now', 'localtime'))
      `).run(bookId, plan.start);
      break;
    case 'resume':
      if (plan.start !== plan.prevStart) {
        db.prepare('UPDATE reads SET date_started = ? WHERE id = ?').run(plan.start, plan.readId);
      }
      break;
    case 'close':
      // Closing it as an exact copy of a completed read already on file
      // would just duplicate that read — drop the open row instead.
      if (plan.alreadyLogged) db.prepare('DELETE FROM reads WHERE id = ?').run(plan.readId);
      else db.prepare('UPDATE reads SET date_started = ?, date_finished = ? WHERE id = ?').run(plan.start, plan.finish, plan.readId);
      break;
    case 'insert':
      if (!plan.alreadyLogged) {
        db.prepare(`
          INSERT INTO reads (book_id, date_started, date_finished, created_at)
          VALUES (?, ?, ?, datetime('now', 'localtime'))
        `).run(bookId, plan.start, plan.finish);
      }
      break;
  }
}

// Route a payload's date_started / date_finished onto the reads table.
// Phase 3: books.date_started / books.date_finished are gone, so any
// API call that carried those fields needs to land them somewhere
// durable. Finish-transition cascades insert their own row separately;
// this helper handles the *non-transition* case — PUT/PATCH calls that
// update dates on an already-finished book, or a POST that supplies
// dates without status='finished'.
//
// Targeting rule: the form shows date_started / date_finished as
// MAX(date_started) and MAX(date_finished) per the attachReadAggregates
// aliasing. Editing the form's date field means "change the read whose
// date the form was displaying" — which is the row holding the current
// MAX for that field, NOT the row with the highest id. Using id DESC
// would silently overwrite a backfilled-out-of-order older read (e.g.
// a 2022 read inserted yesterday into a (2020, 2025) pair, taking the
// highest id while having the smallest date). Falling back to id DESC
// only when no row has the field set; if the book has no reads row at
// all, insert one.
function syncLatestReadsRow(id, payload) {
  if (payload.date_started === undefined && payload.date_finished === undefined) return;

  const haveReads = db.prepare('SELECT 1 FROM reads WHERE book_id = ? LIMIT 1').get(id);
  if (!haveReads) {
    // Nothing to record: the edit form sends date_started / date_finished
    // as null on every save, so a never-read book used to gain a blank
    // (NULL → NULL) read each time it was edited.
    if (!t(payload.date_started) && !t(payload.date_finished)) return;
    assertReadOrder(t(payload.date_started) || null, t(payload.date_finished) || null);
    db.prepare(`
      INSERT INTO reads (book_id, date_started, date_finished, created_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
    `).run(id, t(payload.date_started) || null, t(payload.date_finished) || null);
    return;
  }

  // Each field PATCHes the row whose value is currently the displayed
  // MAX for that field. The two updates can target different rows
  // (latest-finish read vs. latest-start read) when those rows diverge
  // — uncommon, but the form would have shown the divergent values
  // from different rows so editing each independently is correct.
  const pickRowFor = field => {
    const byMax = db.prepare(`
      SELECT id FROM reads
       WHERE book_id = ? AND ${field} IS NOT NULL
       ORDER BY ${field} DESC, id DESC
       LIMIT 1
    `).get(id);
    if (byMax) return byMax.id;
    // No row has the field set yet — fall back to the most recently
    // inserted row so the new value lands on the user's freshest
    // engagement with the book rather than an old DNF or backfill.
    const fallback = db.prepare('SELECT id FROM reads WHERE book_id = ? ORDER BY id DESC LIMIT 1').get(id);
    return fallback.id;
  };

  // Resolve both targets first and check each row's resulting pair before
  // writing, so an edit can't leave a read finishing before it started.
  // Only rows whose dates actually change are checked: a form save echoing
  // an already-inverted legacy row must not be blocked from saving an
  // unrelated field.
  const startRowId  = payload.date_started  !== undefined ? pickRowFor('date_started')  : null;
  const finishRowId = payload.date_finished !== undefined ? pickRowFor('date_finished') : null;
  const next = new Map();
  for (const rowId of [startRowId, finishRowId]) {
    if (rowId == null || next.has(rowId)) continue;
    const row = db.prepare('SELECT date_started, date_finished FROM reads WHERE id = ?').get(rowId);
    next.set(rowId, { before: row, after: { ...row } });
  }
  if (startRowId  != null) next.get(startRowId).after.date_started   = t(payload.date_started)  || null;
  if (finishRowId != null) next.get(finishRowId).after.date_finished = t(payload.date_finished) || null;
  for (const { before, after } of next.values()) {
    if (after.date_started !== before.date_started || after.date_finished !== before.date_finished) {
      assertReadOrder(after.date_started, after.date_finished);
    }
  }
  for (const [rowId, { after }] of next) {
    db.prepare('UPDATE reads SET date_started = ?, date_finished = ? WHERE id = ?')
      .run(after.date_started, after.date_finished, rowId);
  }
}

export function patchBook(id, patch) {
  const existing = db.prepare('SELECT id, current_page, current_minutes, cover_path, status, read_count, owned FROM books WHERE id = ?').get(id);
  if (!existing) return null;

  const { current_page, current_minutes, loved, on_readlist, is_stub, fiction, owned, previously_owned, acquisition_source, description, notes, review, asin, archived, binding, format, condition, rating, publisher, isbn_10, isbn_13, acquisition_date, date_started, date_finished, year_published, year_edition, year_approximate, year_published_approximate, abridged, page_count, duration_minutes, series, series_number, title, original_language, language, source_type, status, authors, narrators, translators, tags, shelf_id, unit_id, room_id, building_id } = patch;

  // Status changes are reading-session events (see planReadTransition):
  //   * into 'reading' opens a read — or, from 'finished', a new re-read
  //     with progress reset to 0 — or resumes one left open
  //   * into 'finished' closes the open read (or logs a new one), with
  //     date_finished defaulting to today when not supplied; read_count
  //     bumps once per new completion (no manual override on PATCH; use
  //     PUT for that)
  // Per the editions-independence rule, no cross-edition propagation.
  // Dates run through t() so the plan's duplicate guard compares
  // normalized-to-normalized — a whitespace or exotic-hyphen difference
  // can't slip a second row past it. The HTTP PATCH validates the date
  // shape first (isValidPartialDate rejects denormalized input with 400),
  // so this is defence-in-depth for in-process callers (scripts / ingest).
  const isFinishTransition = status === 'finished' && existing.status !== 'finished';
  const readPlan = planReadTransition(id, existing.status, status, existing.read_count, {
    dateStarted:  date_started === undefined ? undefined : t(date_started),
    dateFinished: date_finished === undefined ? todayLocalISO() : t(date_finished),
  });

  const fields = [];
  const params = [];
  // No-op progress patches (re-submitting the same value the form was
  // pre-filled with) used to fall through and rewrite updated_at, which
  // bumped the book to the top of recency-sorted views without any actual
  // change. Drop them from the field list so the UPDATE itself doesn't run.
  // current_page / current_minutes pushes are deferred to just before the
  // transaction so they can use the *clamped* values from the reading-log
  // accounting block below — a typo PATCH that lowered current_minutes
  // below the day's start would otherwise persist and corrupt the next
  // upward correction's logged delta.
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
  if (acquisition_source  !== undefined) { fields.push('acquisition_source = ?');  params.push(t(acquisition_source)); }
  if (description         !== undefined) { fields.push('description = ?');         params.push(tProse(description)); }
  if (binding             !== undefined) { fields.push('binding = ?');             params.push(binding || null); }
  if (format              !== undefined) { fields.push('format = ?');              params.push(format || null); }
  if (condition           !== undefined) { fields.push('condition = ?');           params.push(condition || null); }
  // Values arrive validated (validateBook partial mode in the route) but not
  // tidied: numbers may be strings, ISBNs may carry hyphens, dates spaces.
  // Normalize here, as bookColumns does for PUT, so in-process callers get
  // the same treatment. '' / null clears.
  const num = (v) => (v == null || v === '' ? null : Number(v));
  if (rating              !== undefined) { fields.push('rating = ?');              params.push(num(rating)); }
  if (publisher           !== undefined) { fields.push('publisher = ?');           params.push(t(publisher)); }
  if (isbn_10             !== undefined) { fields.push('isbn_10 = ?');             params.push(normalizeIsbn(isbn_10)); }
  if (isbn_13             !== undefined) { fields.push('isbn_13 = ?');             params.push(normalizeIsbn(isbn_13)); }
  if (acquisition_date    !== undefined) { fields.push('acquisition_date = ?');    params.push(t(acquisition_date) || null); }
  // date_started / date_finished are no longer book columns (Phase 3
  // dropped them in migration 079). The cascade below routes them to a
  // reads-row insert on finish-transition; off-transition PATCHes that
  // touch dates route to the latest reads row update further down.
  if (status              !== undefined) { fields.push('status = ?');              params.push(status || 'unread'); }
  if (readPlan.readCount !== existing.read_count) { fields.push('read_count = ?'); params.push(readPlan.readCount); }
  if (year_published      !== undefined) { fields.push('year_published = ?');      params.push(num(year_published)); }
  if (year_edition        !== undefined) { fields.push('year_edition = ?');        params.push(num(year_edition)); }
  if (page_count          !== undefined) { fields.push('page_count = ?');          params.push(num(page_count)); }
  if (duration_minutes    !== undefined) { fields.push('duration_minutes = ?');    params.push(num(duration_minutes)); }
  if (series_number       !== undefined) { fields.push('series_number = ?');       params.push(num(series_number)); }
  if (title               !== undefined) { fields.push('title = ?');               params.push(t(title)); }
  if (series              !== undefined) { fields.push('series = ?');              params.push(t(series)); }
  if (original_language   !== undefined) { fields.push('original_language = ?');   params.push(t(original_language)); }
  // NOT NULL column: an empty language falls back to English, as on PUT
  // (it used to hit the constraint and 500).
  if (language            !== undefined) { fields.push('language = ?');            params.push(t(language) || 'English'); }
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
  // An archived book (already, or archived by this same patch) stays off
  // the readlist — archiving is what takes it off.
  const willBeArchived = archived !== undefined
    ? !!archived
    : !!db.prepare('SELECT archived FROM books WHERE id = ?').get(id)?.archived;
  if (on_readlist !== undefined && !(on_readlist && willBeArchived)) {
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

  // Cross-field rules (gatedColumns), re-run on the row as it will be after
  // this patch whenever the patch touches an input or a gated column. Each
  // consequence that differs from what the patch would otherwise leave is
  // appended to the SET list; SQLite applies the rightmost assignment when
  // a column repeats, so the rule's value wins over the patch's own push.
  if (GATE_INPUT_KEYS.some(k => patch[k] !== undefined)) {
    const cur = db.prepare(`
      SELECT is_custom, owned, previously_owned, format, fiction, shelf_id, unit_id, room_id, building_id,
             condition, binding, duration_minutes, acquisition_source, acquisition_date, source_type
        FROM books WHERE id = ?
    `).get(id);
    const locPatched = shelf_id !== undefined || unit_id !== undefined || room_id !== undefined || building_id !== undefined;
    const next = {
      is_custom:          cur.is_custom,
      owned:              owned            !== undefined ? (owned ? 1 : 0) : cur.owned,
      previously_owned:   previously_owned !== undefined ? (previously_owned ? 1 : 0) : cur.previously_owned,
      format:             format           !== undefined ? (format || null) : cur.format,
      fiction:            fiction          !== undefined ? (fiction == null ? null : (fiction ? 1 : 0)) : cur.fiction,
      ...(locPatched
        ? normalizeBookLocation({ shelf_id, unit_id, room_id, building_id })
        : { shelf_id: cur.shelf_id, unit_id: cur.unit_id, room_id: cur.room_id, building_id: cur.building_id }),
      condition:          condition        !== undefined ? (condition || null) : cur.condition,
      binding:            binding          !== undefined ? (binding || null) : cur.binding,
      duration_minutes:   duration_minutes !== undefined ? (duration_minutes == null || duration_minutes === '' ? null : duration_minutes) : cur.duration_minutes,
      acquisition_source: acquisition_source !== undefined ? t(acquisition_source) : cur.acquisition_source,
      acquisition_date:   acquisition_date   !== undefined ? (acquisition_date || null) : cur.acquisition_date,
      source_type:        source_type      !== undefined ? (source_type || null) : cur.source_type,
    };
    for (const [col, value] of Object.entries(gatedColumns(next))) {
      if (value !== next[col]) { fields.push(`${col} = ?`); params.push(value); }
    }
  }

  // Reading-log accounting for current_page / current_minutes PATCHes.
  //
  // The naive model (logged delta = max(0, new - old)) over-counted when a
  // user made a wrong PATCH that lowered current_minutes and then corrected
  // upward: the downward PATCH lowered the baseline silently (no log
  // change because deltas are floored at zero), then the upward correction
  // logged a delta against the *lower* baseline rather than the real
  // pre-typo high-water mark. Example: 359 → 304 (typo, no log) → 476
  // (correction, logged 172) — when the user only actually advanced
  // 359 → 476 = 117 minutes. The 55 minutes of phantom regression got
  // double-counted on the way back up.
  //
  // Fix: compute today's log declaratively as (effective_current_value -
  // yesterday_end_value), where yesterday_end is reconstructed as
  // (existing_current - existing_today_log) and effective_current clamps
  // to at-least yesterday_end. The clamp prevents a downward PATCH from
  // resetting the baseline below where the user was at the end of
  // yesterday; subsequent forward PATCHes then log against the correct
  // pre-typo position. Today's reading_log row is REPLACED (not
  // incremented) on every PATCH so the row stays equal to the
  // recomputed value, which means repeated PATCHes on the same day
  // can't drift apart from the (current - yesterday_end) invariant.
  const existingTodayLog = db.prepare(`
    SELECT pages_read, minutes_read FROM reading_log
    WHERE book_id = ? AND date = date('now', 'localtime') AND story_id IS NULL
  `).get(id) || { pages_read: 0, minutes_read: 0 };
  // A re-read starts over from 0: measuring against the previous read's
  // end would clamp every new position back up to it.
  const progressBase = readPlan.resetProgress
    ? { current_page: existing.current_page == null ? null : 0, current_minutes: existing.current_minutes == null ? null : 0 }
    : existing;
  const yesterdayEndPage    = (progressBase.current_page    ?? 0) - (existingTodayLog.pages_read   ?? 0);
  const yesterdayEndMinutes = (progressBase.current_minutes ?? 0) - (existingTodayLog.minutes_read ?? 0);
  const clampedCurrentPage    = current_page    !== undefined
    ? Math.max(current_page,    yesterdayEndPage)
    : undefined;
  const clampedCurrentMinutes = current_minutes !== undefined
    ? Math.max(current_minutes, yesterdayEndMinutes)
    : undefined;
  const newTodayPages   = clampedCurrentPage    !== undefined
    ? Math.max(0, clampedCurrentPage    - yesterdayEndPage)
    : existingTodayLog.pages_read   ?? 0;
  const newTodayMinutes = clampedCurrentMinutes !== undefined
    ? Math.max(0, clampedCurrentMinutes - yesterdayEndMinutes)
    : existingTodayLog.minutes_read ?? 0;
  const wantsLogChange = current_page !== undefined || current_minutes !== undefined;

  // Deferred current_page / current_minutes column writes — use clamped
  // values (see reading-log accounting comment above for the rationale).
  // The no-op check mirrors the original guard so a re-submission of the
  // same value still skips the UPDATE and doesn't bump updated_at.
  const nextCurrentPage    = clampedCurrentPage    !== undefined ? clampedCurrentPage    : progressBase.current_page;
  const nextCurrentMinutes = clampedCurrentMinutes !== undefined ? clampedCurrentMinutes : progressBase.current_minutes;
  if (nextCurrentPage    !== undefined && nextCurrentPage    !== (existing.current_page    ?? null)) {
    fields.push('current_page = ?');    params.push(nextCurrentPage    ?? null);
  }
  if (nextCurrentMinutes !== undefined && nextCurrentMinutes !== (existing.current_minutes ?? null)) {
    fields.push('current_minutes = ?'); params.push(nextCurrentMinutes ?? null);
  }

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
    // Status change → reading-session event (open / resume / close / log
    // the read). Mirrors updateBook (PUT), including the duplicate guard.
    if (readPlan.kind !== 'none') applyReadTransition(id, readPlan);
    if (isFinishTransition) {
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
    if (readPlan.kind === 'none') {
      // No status change: PATCHed dates go to the latest reads row
      // (Phase 3: books.date_started/date_finished are gone, this is
      // where dates live now).
      syncLatestReadsRow(id, patch);
    }
    if (wantsLogChange) {
      // story_id defaults to NULL — book-level row, targets the partial
      // unique index on (book_id, date) WHERE story_id IS NULL.
      // REPLACE semantic: today's reading_log row is set to the
      // recomputed (current - yesterday_end) value, not incremented.
      // That keeps repeated PATCHes on the same day idempotent and
      // self-correcting: a wrong PATCH followed by a fix recomputes
      // the right total, where the old += accumulation would double-
      // count or carry phantom regressions forward.
      if (newTodayPages > 0 || newTodayMinutes > 0) {
        db.prepare(`
          INSERT INTO reading_log (book_id, date, pages_read, minutes_read)
          VALUES (?, date('now', 'localtime'), ?, ?)
          ON CONFLICT(book_id, date) WHERE story_id IS NULL DO UPDATE SET
            pages_read   = excluded.pages_read,
            minutes_read = excluded.minutes_read
        `).run(id, newTodayPages, newTodayMinutes);
      } else if (existingTodayLog.pages_read > 0 || existingTodayLog.minutes_read > 0) {
        // Both values fell to zero — clear today's book-level row so
        // the diary doesn't show a phantom empty entry.
        db.prepare(`
          DELETE FROM reading_log
          WHERE book_id = ? AND date = date('now', 'localtime') AND story_id IS NULL
        `).run(id);
      }
    }
  })();

  // Cover file deletion happens AFTER the transaction so a rollback
  // can't leave us with a deleted file pointing at a still-live row.
  // Mirrors updateBook's deferred deleteLocalCover() call.
  if (oldCoverToDelete) deleteLocalCover(oldCoverToDelete);

  return getBook(id);
}

export function deleteBook(id) {
  const book = db.prepare('SELECT cover_path, work_id FROM books WHERE id = ?').get(id);
  if (!book) return false;
  db.transaction(() => {
    // The books cascade removes book_authors / book_narrators /
    // book_translators / book_tags (and indirectly story_authors via the
    // stories cascade). Any rows in the parent people / tags tables whose
    // last association is gone now become orphans — prune them here so
    // the deletion is fully self-contained, matching what the sync*
    // helpers do during a PUT.
    db.prepare('DELETE FROM books WHERE id = ?').run(id);
    // Same rule as unlinkEdition / mergeBooks: an edition group left with
    // a single member isn't a group — dissolve it.
    if (book.work_id != null) {
      const remaining = db.prepare('SELECT id FROM books WHERE work_id = ?').all(book.work_id);
      if (remaining.length === 1) {
        db.prepare("UPDATE books SET work_id = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?").run(remaining[0].id);
      }
    }
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
  // cover_bytes stays in lockstep with cover_path (it drives the hi-res
  // filter and the audit's low-res check) and updated_at marks the change,
  // as on every other cover write. The old file goes only after the row
  // points at the new one.
  db.prepare(`
    UPDATE books SET cover_path = ?, cover_bytes = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
  `).run(filename, measureCoverBytes(filename), id);
  deleteLocalCover(book.cover_path);
  return { book: getBook(id) };
}
