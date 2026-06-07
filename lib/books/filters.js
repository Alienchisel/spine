import { buildSearchCondition } from './searchQuery.js';

// Virtual-tag rules: each rule's `name` must also appear in
// shared/bookFields.js → VIRTUAL_TAG_NAMES so the form filters them out of
// past-tag suggestions. Two lists exist because this file pulls in server-only
// SQLite imports and can't be loaded in the browser bundle.
export const VIRTUAL_TAG_RULES = Object.freeze([
  {
    // Antique/Vintage signal a physically older copy, so we restrict to
    // format='physical'. A 200-year-old text with a recent audiobook edition
    // shouldn't qualify; a 1900 hardcover should.
    name: 'Antique',
    test: (book) => {
      const year = book.year_edition;
      return Boolean(book.format === 'physical' && year && new Date().getFullYear() - year >= 100);
    },
    sql: "(format = 'physical' AND year_edition IS NOT NULL AND (CAST(strftime('%Y','now','localtime') AS INTEGER) - year_edition) >= 100)",
  },
  {
    name: 'Vintage',
    test: (book) => {
      const year = book.year_edition;
      const age = year && new Date().getFullYear() - year;
      return Boolean(book.format === 'physical' && age && age >= 50 && age < 100);
    },
    sql: "(format = 'physical' AND year_edition IS NOT NULL AND (CAST(strftime('%Y','now','localtime') AS INTEGER) - year_edition) >= 50 AND (CAST(strftime('%Y','now','localtime') AS INTEGER) - year_edition) < 100)",
  },
  {
    name: 'Translated',
    test: (book) => Boolean(book.original_language && book.original_language !== book.language),
    sql: "(original_language IS NOT NULL AND original_language != '' AND (language IS NULL OR original_language != language))",
  },
  {
    name: 'Re-read',
    test: (book) => book.read_count > 1,
    sql: "(read_count > 1)",
  },
  {
    name: 'Abridged',
    test: (book) => Boolean(book.abridged),
    sql: "(abridged = 1)",
  },
  {
    name: 'Long',
    // Audio-equivalent of 500 pages is ~14 hours (840 min) at typical
    // narration pace — the rule covers both axes so a 25-hour audiobook
    // qualifies the same way a 500-page ebook does. Upper bound at 1000
    // pages / 1680 minutes hands the truly massive works over to the
    // Tome bucket, mirroring how Antique/Vintage carve up the older end.
    test: (book) =>
      (book.page_count >= 500 && book.page_count < 1000) ||
      (book.duration_minutes >= 840 && book.duration_minutes < 1680),
    sql: "((page_count >= 500 AND page_count < 1000) OR (duration_minutes >= 840 AND duration_minutes < 1680))",
  },
  {
    name: 'Tome',
    // The superlative of Long. 1000+ pages or ~28+ hours covers
    // doorstoppers like complete-works volumes, the KJV Bible, dense
    // tomes that deserve their own bucket. Mutually exclusive with Long
    // (Vintage/Antique-style split).
    test: (book) => book.page_count >= 1000 || book.duration_minutes >= 1680,
    sql: "(page_count >= 1000 OR duration_minutes >= 1680)",
  },
  {
    name: 'Short',
    // Audio-equivalent of 150 pages is ~4 hours (240 min). Mirror the
    // both-axes shape so short audio works register too.
    test: (book) =>
      (book.page_count > 0 && book.page_count <= 150) ||
      (book.duration_minutes > 0 && book.duration_minutes <= 240),
    sql: "((page_count > 0 AND page_count <= 150) OR (duration_minutes > 0 AND duration_minutes <= 240))",
  },
]);

const BROWSE_FIELDS = new Set(['publisher', 'series', 'language', 'original_language', 'format']);
// Bookseller-grade condition values — match the books.condition CHECK.
const CONDITION_VALUES = new Set(['new', 'fine', 'very good', 'good', 'fair', 'poor']);

export function appendWhere(where, extra) {
  return where ? `${where} AND (${extra})` : `WHERE (${extra})`;
}

export function buildFilterConditions(query) {
  const conditions = [];
  const params = [];

  const tab = query.tab || query.status;
  if      (tab === 'reading')    conditions.push("status = 'reading'");
  else if (tab === 'finished')   conditions.push("status = 'finished'");
  // Wishlist stubs literally satisfy status='unread' (they default there),
  // but "Unread" is the queue of books to pick up and read — a placeholder
  // you don't own yet isn't actionable here. Exclude.
  else if (tab === 'unread')     conditions.push("status = 'unread' AND COALESCE(is_stub,0) = 0");
  else if (tab === 'owned')      conditions.push("owned = 1");
  else if (tab === 'prev_owned') conditions.push("previously_owned = 1");
  else if (tab === 'never_owned') conditions.push("owned = 0 AND COALESCE(previously_owned,0) = 0 AND COALESCE(is_custom,0) = 0");
  else if (tab === 'loved')      conditions.push("loved = 1");
  else if (tab === 'archived')   conditions.push("archived = 1");

  // `progress=any` narrows to books with any logged reading activity —
  // finished, currently in-progress, with a prior read on record, or
  // story-level logged in an anthology (book-level current_page stays 0
  // when the user reads an anthology story-by-story, so the reading_log
  // check is the only way to surface those). Used by the Stats hero
  // strip so "Pages read" / "Hours listened" click through to the
  // actual cohort the numbers came from rather than the entire format
  // catalog.
  if (query.progress === 'any') {
    conditions.push(
      "(status = 'finished' "
      + "OR COALESCE(current_page,0) > 0 "
      + "OR COALESCE(current_minutes,0) > 0 "
      + "OR COALESCE(read_count,0) > 0 "
      + "OR id IN (SELECT book_id FROM reading_log))"
    );
  }

  // Archived books are hidden from "current library" surfaces by default,
  // so they don't pollute browsing. Two exceptions:
  //   1. `tab='archived'` opts into archived-only (already handled above).
  //   2. A free-text search query (q) flips the default to include both, so
  //      the search bar surfaces every match — otherwise an archived book
  //      becomes unfindable except via the Archived tab. Callers that want
  //      strictly-active search results can override with archived='0'.
  // Explicit `archived='any'` always includes both; `archived='1'`/`'true'`
  // restricts to archived only; `archived='0'`/`'false'` forces exclusion.
  if (tab !== 'archived') {
    const archivedParam = query.archived;
    if      (archivedParam === 'any')                                  { /* no filter */ }
    else if (archivedParam === '1'    || archivedParam === 'true')     conditions.push("archived = 1");
    else if (archivedParam === '0'    || archivedParam === 'false')    conditions.push("COALESCE(archived,0) = 0");
    else if (query.q && String(query.q).trim())                        { /* free-text search includes archived */ }
    else                                                                conditions.push("COALESCE(archived,0) = 0");
  }

  // `has_writing=1` narrows to books where the user has written either
  // a review or notes (or both). Powers the /notes index — the surface
  // that brings the reflective layer (user-authored prose about books)
  // forward as a first-class destination rather than buried per-book.
  if (query.has_writing === '1' || query.has_writing === 'true') {
    conditions.push("((notes IS NOT NULL AND notes != '') OR (review IS NOT NULL AND review != ''))");
  }

  // Multi-status filter (orthogonal to tab). On a single-status tab this
  // would just AND a redundant or contradictory clause, so the UI hides the
  // chips on those tabs — but the backend accepts the param either way.
  const statuses = [].concat(query.statuses || []).filter(Boolean);
  if (statuses.length) {
    conditions.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }

  if (query.field && query.value != null) {
    const f = query.field;
    const v = query.value;
    if (f === 'tag') {
      // Virtual tags (Antique / Vintage / Long / Tome / etc.) don't live
      // in the `tags` table, so a real-tag JOIN finds nothing for them.
      // Route to the rule's SQL predicate instead; fall through to the
      // real-tag JOIN for everything else.
      const virtualRule = VIRTUAL_TAG_RULES.find(r => r.name === v);
      if (virtualRule) {
        conditions.push(virtualRule.sql);
      } else {
        conditions.push("id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE t.name = ?)");
        params.push(v);
      }
    } else if (f === 'narrator') {
      conditions.push("id IN (SELECT bn.book_id FROM book_narrators bn JOIN narrators n ON bn.narrator_id = n.id WHERE n.name = ?)");
      params.push(v);
    } else if (f === 'author') {
      conditions.push("id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE a.name = ?)");
      params.push(v);
    } else if (f === 'author_gender') {
      // "Any author of the book has this gender." Matches the Stats-page
      // breakdown's "books I have at least one female author for"
      // semantics. The 'unassigned' bucket maps to gender IS NULL so the
      // bar links to "books with at least one untagged author".
      if (v === 'unassigned') {
        conditions.push("id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE a.gender IS NULL)");
      } else {
        conditions.push("id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE a.gender = ?)");
        params.push(v);
      }
    } else if (f === 'translator') {
      conditions.push("id IN (SELECT bt.book_id FROM book_translators bt JOIN translators t ON bt.translator_id = t.id WHERE t.name = ?)");
      params.push(v);
    } else if (f === 'fiction') {
      if (v === 'fiction')         conditions.push("fiction = 1");
      else if (v === 'nonfiction') conditions.push("fiction = 0");
      else                         conditions.push("fiction IS NULL");
    } else if (f === 'rating') {
      conditions.push("rating = ?");
      params.push(parseFloat(v));
    } else if (f === 'year_finished') {
      conditions.push("date_finished LIKE ?");
      params.push(v + '%');
    } else if (f === 'year_acquired') {
      conditions.push("acquisition_date LIKE ?");
      params.push(v + '%');
    } else if (BROWSE_FIELDS.has(f)) {
      conditions.push(`${f} = ?`);
      params.push(v);
    }
  }

  if (query.q) {
    const cond = buildSearchCondition(query.q);
    if (cond) {
      conditions.push(cond.sql);
      params.push(...cond.params);
    }
  }

  const fmts = [].concat(query.formats || []).filter(Boolean);
  if (fmts.length) {
    const hasEmpty = fmts.includes('empty');
    const real = fmts.filter(f => f !== 'empty');
    if (hasEmpty && real.length) { conditions.push(`(format IS NULL OR format IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("format IS NULL");
    else { conditions.push(`format IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const rts = [].concat(query.ratings || []).filter(Boolean);
  if (rts.length) {
    const hasEmpty = rts.includes('empty');
    const real = rts.filter(r => r !== 'empty').map(Number).filter(n => !isNaN(n));
    if (hasEmpty && real.length) { conditions.push(`(rating IS NULL OR rating IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("rating IS NULL");
    else { conditions.push(`rating IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const pubs = [].concat(query.publishers || []).filter(Boolean);
  if (pubs.length) {
    const hasEmpty = pubs.includes('empty');
    const real = pubs.filter(p => p !== 'empty');
    if (hasEmpty && real.length) { conditions.push(`(publisher IS NULL OR publisher IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("(publisher IS NULL OR publisher = '')");
    else { conditions.push(`publisher IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const srcs = [].concat(query.sources || []).filter(Boolean);
  if (srcs.length) {
    // Two special tokens alongside literal source names:
    //   'empty' → acquisition_source IS NULL or ''
    //   'other' → has a value but isn't one of the four named lanes
    //             (Kindle / Audible / Internet / Amazon). Mirrors the
    //             "Other" bucket on Stats's Source donut so the legend
    //             link there can round-trip into Library.
    const SOURCE_NAMED = ['Kindle', 'Audible', 'Internet', 'Amazon'];
    const hasEmpty = srcs.includes('empty');
    const hasOther = srcs.includes('other');
    const real = srcs.filter(s => s !== 'empty' && s !== 'other');
    const clauses = [];
    if (real.length) {
      clauses.push(`acquisition_source IN (${real.map(() => '?').join(',')})`);
      params.push(...real);
    }
    if (hasEmpty) {
      clauses.push("(acquisition_source IS NULL OR acquisition_source = '')");
    }
    if (hasOther) {
      clauses.push(`(acquisition_source IS NOT NULL AND acquisition_source != '' AND acquisition_source NOT IN (${SOURCE_NAMED.map(() => '?').join(',')}))`);
      params.push(...SOURCE_NAMED);
    }
    if (clauses.length) conditions.push(`(${clauses.join(' OR ')})`);
  }

  const sers = [].concat(query.series || []).filter(Boolean);
  if (sers.length) {
    const hasEmpty = sers.includes('empty');
    const real = sers.filter(s => s !== 'empty');
    if (hasEmpty && real.length) { conditions.push(`(series IS NULL OR series IN (${real.map(() => '?').join(',')}))`); params.push(...real); }
    else if (hasEmpty) conditions.push("(series IS NULL OR series = '')");
    else { conditions.push(`series IN (${real.map(() => '?').join(',')})`); params.push(...real); }
  }

  const selectedTags = [].concat(query.tags || []).filter(Boolean);
  if (selectedTags.length) {
    const virtualNames = new Set(VIRTUAL_TAG_RULES.map(r => r.name));
    const realTags = selectedTags.filter(t => !virtualNames.has(t));
    const virtualTags = selectedTags.filter(t => virtualNames.has(t));
    // tagsMode controls how multiple selected real tags combine.
    // 'all' (default) requires every tag to be present on the book — matches
    // the search-bar AND-default and the way the user tags in practice
    // (orthogonal qualities like Sci-Fi + Manga). 'any' is the legacy
    // multi-select facet behavior. Single tags are unaffected. Virtual tags
    // are always ANDed since each is its own condition.
    const tagsMode = query.tagsMode === 'any' ? 'any' : 'all';
    if (realTags.length) {
      if (tagsMode === 'all' && realTags.length > 1) {
        conditions.push(
          `id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE t.name IN (${realTags.map(() => '?').join(',')}) GROUP BY bt.book_id HAVING COUNT(DISTINCT t.name) = ?)`
        );
        params.push(...realTags, realTags.length);
      } else {
        conditions.push(`id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE t.name IN (${realTags.map(() => '?').join(',')}))`);
        params.push(...realTags);
      }
    }
    for (const name of virtualTags) {
      const rule = VIRTUAL_TAG_RULES.find(r => r.name === name);
      if (rule) conditions.push(rule.sql);
    }
  }

  const missing = [].concat(query.missing || []).filter(Boolean);
  for (const m of missing) {
    if (m === 'cover')           conditions.push("(cover_path IS NULL OR cover_path = '')");
    // Low-res-cover audit. Cover exists but the file is small enough that
    // it almost certainly looks bad zoomed or at large thumbnail size.
    // 40_000 bytes is the working threshold — generous enough that
    // genuinely-fine minimalist covers (~30-50KB) mostly slip through,
    // tight enough that the cohort the wizard surfaces is the ones the
    // user actually wants to replace. measureCoverBytes returns null on
    // missing/unreadable files; COALESCE keeps those out of the audit
    // since "no file" is the missing=cover concern, not this one.
    else if (m === 'hi_res_cover') conditions.push(
      "COALESCE(is_stub,0)=0 AND cover_path IS NOT NULL AND cover_path != '' AND cover_bytes IS NOT NULL AND cover_bytes < 40000"
    );
    else if (m === 'author')     conditions.push("id NOT IN (SELECT book_id FROM book_authors)");
    // Edition-specific fields (narrator, binding, translator, isbn,
    // publisher, page_count, duration) get a COALESCE(is_stub,0)=0 guard
    // so wishlist placeholders don't surface in the audit. The whole
    // point of a stub is "edition TBD, fill in when acquired" — asking
    // for the narrator / binding / publisher / etc. is the wrong question
    // until graduation. Work-level missing= filters (author, language,
    // original_language, series, series_number, description) keep stubs
    // because those facts are typically known at placeholder-creation.
    else if (m === 'narrator')   conditions.push("COALESCE(is_stub,0)=0 AND format = 'audiobook' AND id NOT IN (SELECT book_id FROM book_narrators)");
    else if (m === 'binding')    conditions.push("COALESCE(is_stub,0)=0 AND format = 'physical' AND (binding IS NULL OR binding = '')");
    else if (m === 'translator') conditions.push("COALESCE(is_stub,0)=0 AND original_language IS NOT NULL AND original_language != '' AND id NOT IN (SELECT book_id FROM book_translators)");
    // Reverse of missing=translator: a book wears a translator but
    // no original_language is recorded. Symmetric gap — if you noted
    // the translator, you almost certainly know what they translated
    // from.
    else if (m === 'original_language') conditions.push(
      "id IN (SELECT book_id FROM book_translators) AND (original_language IS NULL OR original_language = '')"
    );
    else if (m === 'format')     conditions.push("format IS NULL");
    else if (m === 'isbn')       conditions.push("COALESCE(is_stub,0)=0 AND COALESCE(is_custom,0)=0 AND (format IS NULL OR format NOT IN ('ebook')) AND isbn_10 IS NULL AND isbn_13 IS NULL AND asin IS NULL AND NOT (COALESCE(year_published,0)<1970 AND COALESCE(year_edition,0)<1970)");
    // is_custom + is_stub guards mirror missing=isbn: custom
    // (user-assembled) books and wishlist placeholders don't have
    // publishers / acquisition sources / acquisition dates as a matter of
    // model — surfacing them in a "missing X" maintenance filter is noise.
    else if (m === 'publisher')  conditions.push("COALESCE(is_stub,0)=0 AND COALESCE(is_custom,0)=0 AND (publisher IS NULL OR publisher = '')");
    else if (m === 'year')       conditions.push("year_published IS NULL");
    // year_edition is the printing year (1997 Hackett reprint of a 1937
    // original, etc.) and feeds the Antique/Vintage virtual tags that
    // are gated on physical format. Missing it on a physical book means
    // those virtual tags can't fire correctly.
    else if (m === 'year_edition') conditions.push("format = 'physical' AND year_edition IS NULL");
    // Strict-cascade shelving filters. Each catches books pinned AT a
    // specific level, with the next-finer level unspecified. The
    // normalize_location_fields invariant guarantees at most one pin
    // column is non-null, so these don't overlap.
    //   missing=room   → pinned at building only (needs a room next)
    //   missing=unit   → pinned at room only      (needs a unit next)
    //   missing=shelf  → pinned at unit only      (needs a shelf next)
    // The all-null case is already covered by missing=location.
    else if (m === 'room')  conditions.push(
      "format = 'physical' AND building_id IS NOT NULL AND room_id IS NULL AND unit_id IS NULL AND shelf_id IS NULL"
    );
    else if (m === 'unit')  conditions.push(
      "format = 'physical' AND room_id IS NOT NULL AND unit_id IS NULL AND shelf_id IS NULL"
    );
    else if (m === 'shelf') conditions.push(
      "format = 'physical' AND unit_id IS NOT NULL AND shelf_id IS NULL"
    );
    // Books pointing at a deleted shelf/unit/room/building. FK ON DELETE
    // SET NULL / CASCADE should prevent this in normal operation, but
    // the audit is a useful data-integrity check against migration
    // mistakes or hand-edited rows.
    else if (m === 'orphan_pin') conditions.push(
      "(shelf_id IS NOT NULL AND shelf_id NOT IN (SELECT id FROM shelves))"
      + " OR (unit_id IS NOT NULL AND unit_id NOT IN (SELECT id FROM units))"
      + " OR (room_id IS NOT NULL AND room_id NOT IN (SELECT id FROM rooms))"
      + " OR (building_id IS NOT NULL AND building_id NOT IN (SELECT id FROM buildings))"
    );
    // Split format-specific size curation into two filters:
    //   - missing=pages    → non-audiobook with no page_count
    //                        (the print-pages curation, narrowed).
    //   - missing=duration → audiobook with no duration_minutes
    //                        (unusable audiobook).
    // missing=page_count (below) catches page_count missing on any
    // format — mostly audiobooks without their print-equivalent.
    else if (m === 'pages')      conditions.push("COALESCE(is_stub,0)=0 AND COALESCE(format,'') != 'audiobook' AND page_count IS NULL");
    else if (m === 'duration')   conditions.push("COALESCE(is_stub,0)=0 AND format = 'audiobook' AND duration_minutes IS NULL");
    else if (m === 'language')   conditions.push("(language IS NULL OR language = '')");
    else if (m === 'rating')     conditions.push("rating IS NULL AND status='finished'");
    else if (m === 'fiction')    conditions.push("fiction IS NULL");
    else if (m === 'description') conditions.push("(description IS NULL OR description = '')");
    else if (m === 'source')     conditions.push("owned = 1 AND COALESCE(is_custom,0)=0 AND (acquisition_source IS NULL OR acquisition_source = '')");
    else if (m === 'acquired')   conditions.push("owned = 1 AND COALESCE(is_custom,0)=0 AND acquisition_date IS NULL");
    // Books pinned to a specific shelf but never dragged into order —
    // the "unpositioned tail" at the end of each shelf. Building/room/
    // unit-level pins don't apply (shelf_position has no meaning there).
    else if (m === 'position')   conditions.push("shelf_id IS NOT NULL AND shelf_position IS NULL");
    // Books without a page_count regardless of format — separate from
    // 'missing=pages' (which is format-specific: page_count for non-
    // audiobook, duration_minutes for audiobook). This one is the
    // sweep-list for audiobooks that need a print-equivalent page count
    // so they appear in cross-format collage / pages-read rankings.
    else if (m === 'page_count') conditions.push("COALESCE(is_stub,0)=0 AND COALESCE(is_custom,0)=0 AND page_count IS NULL");
    // Stories/Anthology-tagged collection with no contents populated yet.
    // Used to surface short-story books whose table-of-contents is still
    // empty so the user can spot what's left to populate.
    else if (m === 'stories')    conditions.push(`id IN (
      SELECT bt.book_id FROM book_tags bt
      JOIN tags t ON t.id = bt.tag_id
      WHERE t.name IN ('Stories', 'Anthology')
    ) AND id NOT IN (SELECT book_id FROM stories)`);
    // Physical books without a condition (new / used). Audiobook / ebook
    // don't carry a condition field meaningfully.
    else if (m === 'condition')  conditions.push("format = 'physical' AND (condition IS NULL OR condition = '')");
    // Physical books that haven't been placed anywhere in the shelf
    // hierarchy. The normalize_location_fields invariant guarantees
    // only one of shelf_id/unit_id/room_id/building_id is set, so
    // "all four null" is the unplaced state.
    else if (m === 'location')   conditions.push(
      "format = 'physical' AND shelf_id IS NULL AND unit_id IS NULL "
      + "AND room_id IS NULL AND building_id IS NULL"
    );
    // Finished reads that never recorded a finish date — usually
    // historical imports or hand-edited status changes.
    else if (m === 'date_finished') conditions.push("status = 'finished' AND date_finished IS NULL");
    // Currently-reading books that never recorded a start date.
    // Parallels missing=date_finished on the entry side of the reading
    // record. Usually a stale status flag or an unfinished diary entry.
    else if (m === 'date_started')  conditions.push("status = 'reading' AND date_started IS NULL");
    // Books marked as in-progress but with no current_page or
    // current_minutes recorded. Usually a stale status flag the user
    // never cleared after putting a book down.
    else if (m === 'progress')   conditions.push(
      "status = 'reading' AND COALESCE(current_page, 0) = 0 AND COALESCE(current_minutes, 0) = 0"
    );
    // Series metadata is two-sided. Either both fields are set together
    // (Wheel of Time #3) or both are blank. A missing series_number on
    // a series-bearing book is an incomplete entry; a missing series on
    // a numbered book is a stranded number with no series to attach it
    // to.
    else if (m === 'series_number') conditions.push(
      "series IS NOT NULL AND series != '' AND series_number IS NULL"
    );
    else if (m === 'series')        conditions.push(
      "series_number IS NOT NULL AND (series IS NULL OR series = '')"
    );
    // Stories vs Anthology are mutually exclusive — Stories is the
    // single-author tag, Anthology is the multi-author tag. A book
    // wearing both is a data error: one of the two needs to come off.
    else if (m === 'stories_anthology') conditions.push(`id IN (
      SELECT bt.book_id FROM book_tags bt
      JOIN tags t ON t.id = bt.tag_id
      WHERE t.name = 'Stories'
    ) AND id IN (
      SELECT bt.book_id FROM book_tags bt
      JOIN tags t ON t.id = bt.tag_id
      WHERE t.name = 'Anthology'
    )`);
  }

  if (query.owned === 'true')            conditions.push("owned = 1");
  else if (query.owned === 'false')      conditions.push("COALESCE(owned,0) = 0");
  if (query.previouslyOwned === 'true')  conditions.push("previously_owned = 1");
  if (query.custom === 'true')           conditions.push("is_custom = 1");
  else if (query.custom === 'false')     conditions.push("COALESCE(is_custom,0) = 0");
  if (query.loved === 'true')            conditions.push("loved = 1");
  else if (query.loved === 'false')      conditions.push("COALESCE(loved,0) = 0");

  // Positive condition filter — complements the missing=condition
  // audit. Values mirror the bookseller-grade enum on the books table
  // (new / fine / very good / good / fair / poor). Unknown values are
  // silently ignored rather than passed through to a no-result query.
  // Compose with formats=physical if the caller wants to be explicit
  // about scope, though in practice only physical books carry a
  // condition.
  if (CONDITION_VALUES.has(query.condition)) {
    conditions.push("condition = ?");
    params.push(query.condition);
  }

  return { conditions, params };
}

// Article-stripping title sort: "The Odyssey" sorts under O, not T. Used by
// the library list AND every shelf-route ORDER BY that falls back to title,
// so the two browsing surfaces feel consistent. Pass a column reference
// (`b.title`, `COALESCE(b.series, b.title)`, etc.) to scope to a join alias
// or a derived expression.
export function titleSortExpr(col = 'title') {
  return `LOWER(CASE WHEN LOWER(${col}) LIKE 'the %' THEN SUBSTR(${col},5) WHEN LOWER(${col}) LIKE 'an %' THEN SUBSTR(${col},4) WHEN LOWER(${col}) LIKE 'a %' THEN SUBSTR(${col},3) ELSE ${col} END)`;
}

// Sorts that callers can use to override the field-based default when
// `field` is set. /browse/series/X and /browse/year_finished/X have
// strong field-appropriate defaults; the rest of the field-based views
// (author, tag, publisher, etc.) let an explicit `sort` flow through to
// the switch below — this is what powers the Author page's sort dropdown.
const FIELD_OVERRIDABLE_SORTS = new Set([
  'title', 'year_published', 'year_published_desc', 'rating', 'added', 'length',
]);
export function buildOrderBy(sort, field, seed) {
  const titleSort = titleSortExpr();
  if (field === 'series')        return `COALESCE(series_number,9999) ASC, ${titleSort} ASC`;
  if (field === 'year_finished') return "date_finished ASC";
  if (field === 'year_acquired') return "acquisition_date ASC";
  if (field && !FIELD_OVERRIDABLE_SORTS.has(sort)) {
    return `${titleSort} ASC, COALESCE(series_number,9999) ASC`;
  }
  switch (sort) {
    case 'added':    return "id DESC";
    case 'title':    return `${titleSort} ASC, COALESCE(series_number,9999) ASC`;
    // Year of first publication. NULLs land last in both directions so a
    // book with no year_published doesn't bump up to the top of either
    // ordering. `COALESCE(year_published, 99999)` for ASC keeps the
    // condition expressible without `NULLS LAST` syntax. Series_number
    // is the secondary tiebreaker (before title) so a same-year trilogy
    // — e.g. Lingao Qilu vols 1/2/3 all published 2009 — falls in
    // reading order rather than alphabetical-by-title order which can
    // happen to invert series order.
    case 'year_published':      return `COALESCE(year_published, 99999) ASC, COALESCE(series_number, 9999) ASC, ${titleSort} ASC`;
    case 'year_published_desc': return `year_published DESC NULLS LAST, COALESCE(series_number, 9999) ASC, ${titleSort} ASC`;
    // The 'author' sort buckets books by first author. Within a bucket
    // (everything by Vance, etc.), use the same chronological-then-
    // series-then-title chain as year_published so a single author's
    // strip reads as a career arc.
    case 'author':   return `COALESCE((SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id = books.id ORDER BY ba.position LIMIT 1), '') ASC, COALESCE(year_published, 99999) ASC, COALESCE(series_number, 9999) ASC, ${titleSort} ASC`;
    // Title is the deterministic tiebreaker for every "buckets-with-
    // ties" sort below. Without it, SQLite returns each tied group in
    // storage order — approximately insertion order, but undefined by
    // spec — which looks indeterministic when the user scrolls a
    // bucket (every 5★ book, every same-length-page book, etc.).
    case 'rating':   return `COALESCE(rating,0) DESC, ${titleSort} ASC`;
    case 'progress': return `CASE WHEN format='audiobook' THEN CAST(COALESCE(current_minutes,0) AS REAL)/NULLIF(duration_minutes,0) ELSE CAST(COALESCE(current_page,0) AS REAL)/NULLIF(page_count,0) END DESC, ${titleSort} ASC`;
    case 'started':  return `COALESCE(date_started,'') DESC, ${titleSort} ASC`;
    case 'finished': return `COALESCE(date_finished,'') DESC, ${titleSort} ASC`;
    case 'length':   return `COALESCE(page_count,duration_minutes,0) DESC, ${titleSort} ASC`;
    // Pure audiobook-duration sort. Distinct from 'length' which prefers
    // page_count when set — useful when the user filters down to
    // audiobooks and wants the order to actually be by listening minutes.
    case 'duration': return `COALESCE(duration_minutes,0) DESC, ${titleSort} ASC`;
    // Series-then-volume. Groups books by series name, then orders
    // within each series by series_number (unset → end of group, books
    // with no series via empty-string COALESCE land last). The Command
    // Palette passes this when the user types a series: qualifier so a
    // series search returns volumes in reading order.
    case 'series':   return `COALESCE(series, '~') ASC, COALESCE(series_number, 9999) ASC, ${titleSort} ASC`;
    // Manual rank for the Library "Never owned" tab (purchase priority).
    // NULL = unranked → sorts last via large COALESCE; among unranked,
    // newest-first so a freshly-added book is visible to slot in.
    case 'custom':   return "COALESCE(desire_rank, 999999) ASC, id DESC";
    // Most-recent reading_log entry (replaces the retired Paused tab as
    // the way to spot stale Reading books — they drift to the bottom).
    // Books with no log entries land last via the empty-string fallback.
    case 'last_logged': return "COALESCE((SELECT MAX(date) FROM reading_log WHERE book_id = books.id), '') DESC, updated_at DESC";
    case 'random': {
      // Deterministic shuffle keyed by `seed` — stable for pagination and
      // refetches, re-rolls when the client passes a new seed (the "die"
      // button on the Library sort row). Knuth-style multiplicative mix
      // of id and seed scrambles well even for adjacent ids; tie-breaker
      // on id keeps the order stable when the hash collides modulo 9301.
      // Seed is coerced to a positive integer here so a malformed query
      // string can't inject SQL.
      const s = Math.max(1, Math.floor(Number(seed)) || 1);
      return `((id * 2654435761 + ${s} * 22695477) % 9301) ASC, id ASC`;
    }
    default:         return "updated_at DESC";
  }
}
