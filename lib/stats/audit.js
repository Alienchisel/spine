import db from '../../db.js';

// Curation health. Hidden page at /audit. Single source of truth for the
// counts, the click-through URLs that land in Library, and the per-row
// population numbers used to compute the overall % clean figure.
//
// Each row has both:
//   - gapSql:        WHERE clause selecting books with the gap
//   - populationSql: WHERE clause selecting books eligible for the gap
//                    (gapSql without the "missing" predicate)
// Cleanliness % = 1 − (Σ gap counts / Σ population counts), weighted by
// audit scope. A small audit (e.g. 1 of 5 audiobooks) contributes less
// to the score than a big one (e.g. 50 of 500 books), which makes the
// number track real curation work rather than counting audits.
//
// The audit is comprehensive: it covers every metadata gap the user
// might want to chase down. If a row becomes pure noise, drop it —
// the underlying `missing=` filter remains available from the Library
// filter panel either way.
const AUDITS = [
  {
    heading: 'Acquisition',
    rows: [
      {
        label: 'Owned books have acquisition date',
        gapSql:        "owned = 1 AND COALESCE(is_custom,0) = 0 AND acquisition_date IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=acquired',
        wizardKey:     'acquisition_date',
      },
      {
        label: 'Owned books have acquisition source',
        gapSql:        "owned = 1 AND COALESCE(is_custom,0) = 0 AND (acquisition_source IS NULL OR acquisition_source = '') AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=source',
        wizardKey:     'acquisition_source',
      },
    ],
  },
  {
    heading: 'Physical books',
    // Ordered top-down: general physical attributes first (binding,
    // condition, year_edition), then the placement cascade in
    // hierarchical reading order (unplaced → building → room → unit →
    // shelf → position), with the data-integrity orphan check last.
    rows: [
      // ── General physical attributes ────────────────────────────────
      {
        label: 'Physical books have binding',
        gapSql:        "format = 'physical' AND (binding IS NULL OR binding = '') AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=physical&missing=binding',
        // Fill-wizard key: surfaces a deck-of-cards page at
        // /audit/wizard/binding for bulk-clearing this audit. See
        // pages/AuditWizard/. Other rows without a wizardKey just
        // get the standard click-through to Library.
        wizardKey:     'binding',
      },
      {
        label: 'Owned physical books have condition',
        gapSql:        "format = 'physical' AND (condition IS NULL OR condition = '') AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=condition',
        wizardKey:     'condition',
      },
      // year_edition (the printing year, distinct from year_published)
      // feeds the Antique / Vintage virtual tags. Missing it on a
      // physical book means those tags can't fire.
      {
        label: 'Owned physical books have year_edition',
        gapSql:        "format = 'physical' AND year_edition IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=year_edition',
        wizardKey:     'year_edition',
      },
      // ── Placement cascade (top of hierarchy → bottom) ─────────────
      // Catch-all: the book has no placement of any kind.
      {
        label: 'Owned physical books have shelf location',
        gapSql:        "format = 'physical' AND shelf_id IS NULL AND unit_id IS NULL AND room_id IS NULL AND building_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=location',
      },
      // Strict-cascade placement audits. Each catches owned physical
      // books pinned AT a specific level, with the next-finer level
      // unspecified. The four "missing=location" + these three rows
      // + missing=position partition the shelving curation surface.
      {
        label: 'Building-pinned books have a room',
        gapSql:        "format = 'physical' AND building_id IS NOT NULL AND room_id IS NULL AND unit_id IS NULL AND shelf_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=room',
      },
      {
        label: 'Room-pinned books have a unit',
        gapSql:        "format = 'physical' AND room_id IS NOT NULL AND unit_id IS NULL AND shelf_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=unit',
      },
      {
        label: 'Unit-pinned books have a shelf',
        gapSql:        "format = 'physical' AND unit_id IS NOT NULL AND shelf_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=shelf',
      },
      {
        label: 'Shelved books have shelf position',
        gapSql:        "shelf_id IS NOT NULL AND shelf_position IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "shelf_id IS NOT NULL AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=position',
      },
      // ── Integrity ──────────────────────────────────────────────────
      // Books pointing to a non-existent shelf/unit/room/building.
      // FK SET NULL / CASCADE should prevent this normally; the audit
      // is a defensive integrity check.
      {
        label: 'Placed books have a valid pin',
        gapSql: `(
          (shelf_id IS NOT NULL AND shelf_id NOT IN (SELECT id FROM shelves))
          OR (unit_id IS NOT NULL AND unit_id NOT IN (SELECT id FROM units))
          OR (room_id IS NOT NULL AND room_id NOT IN (SELECT id FROM rooms))
          OR (building_id IS NOT NULL AND building_id NOT IN (SELECT id FROM buildings))
        ) AND COALESCE(archived,0) = 0`,
        populationSql: "(shelf_id IS NOT NULL OR unit_id IS NOT NULL OR room_id IS NOT NULL OR building_id IS NOT NULL) AND COALESCE(archived,0) = 0",
        query: 'tab=all&missing=orphan_pin',
      },
    ],
  },
  {
    heading: 'Audiobooks',
    rows: [
      {
        label: 'Audiobooks have narrator',
        gapSql:        "format = 'audiobook' AND id NOT IN (SELECT book_id FROM book_narrators) AND COALESCE(archived,0) = 0",
        populationSql: "format = 'audiobook' AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=audiobook&missing=narrator',
        wizardKey:     'narrators',
      },
      {
        label: 'Audiobooks have duration',
        gapSql:        "format = 'audiobook' AND duration_minutes IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "format = 'audiobook' AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=audiobook&missing=duration',
        wizardKey:     'duration',
      },
      // page_count on an audiobook is the print-equivalent length;
      // surfacing it lets cross-format collage / pages-read rankings
      // include audiobooks instead of skipping them.
      {
        label: 'Audiobooks have page count (cross-format)',
        gapSql:        "format = 'audiobook' AND COALESCE(is_custom,0) = 0 AND page_count IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "format = 'audiobook' AND COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=audiobook&missing=page_count',
        wizardKey:     'page_count',
      },
    ],
  },
  {
    heading: 'Bibliographic',
    rows: [
      {
        label: 'Books have authors',
        gapSql:        "id NOT IN (SELECT book_id FROM book_authors) AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(archived,0) = 0",
        query:         'tab=all&missing=author',
        wizardKey:     'authors',
      },
      {
        label: 'Owned books have year published',
        gapSql:        "owned = 1 AND year_published IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=year',
        wizardKey:     'year_published',
      },
      {
        label: 'Translated works have translator',
        gapSql:        "original_language IS NOT NULL AND original_language != '' AND id NOT IN (SELECT book_id FROM book_translators) AND COALESCE(archived,0) = 0",
        populationSql: "original_language IS NOT NULL AND original_language != '' AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=translator',
        wizardKey:     'translators',
      },
      // Reverse of the above: book has a translator but no
      // original_language. Symmetric metadata gap.
      {
        label: 'Translated books have original language',
        gapSql:        "id IN (SELECT book_id FROM book_translators) AND (original_language IS NULL OR original_language = '') AND COALESCE(archived,0) = 0",
        populationSql: "id IN (SELECT book_id FROM book_translators) AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=original_language',
      },
      {
        label: 'Printed books have ISBN',
        gapSql:        "COALESCE(is_custom,0) = 0 AND (format IS NULL OR format NOT IN ('ebook')) AND isbn_10 IS NULL AND isbn_13 IS NULL AND asin IS NULL AND NOT (COALESCE(year_published,0) < 1970 AND COALESCE(year_edition,0) < 1970) AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(is_custom,0) = 0 AND (format IS NULL OR format NOT IN ('ebook')) AND NOT (COALESCE(year_published,0) < 1970 AND COALESCE(year_edition,0) < 1970) AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=isbn',
        wizardKey:     'isbn',
      },
      {
        label: 'Books have publisher',
        gapSql:        "COALESCE(is_custom,0) = 0 AND (publisher IS NULL OR publisher = '') AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=publisher',
        wizardKey:     'publisher',
      },
      {
        label: 'Owned books have language',
        gapSql:        "owned = 1 AND (language IS NULL OR language = '') AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=language',
      },
      {
        label: 'Owned books have fiction flag',
        gapSql:        "owned = 1 AND fiction IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=fiction',
        wizardKey:     'fiction',
      },
      {
        label: 'Books have description',
        gapSql:        "(description IS NULL OR description = '') AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(archived,0) = 0",
        query:         'tab=all&missing=description',
        wizardKey:     'description',
      },
      {
        label: 'Series-tagged books have series number',
        gapSql:        "series IS NOT NULL AND series != '' AND series_number IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "series IS NOT NULL AND series != '' AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=series_number',
        wizardKey:     'series_number',
      },
      {
        label: 'Numbered books have a series',
        gapSql:        "series_number IS NOT NULL AND (series IS NULL OR series = '') AND COALESCE(archived,0) = 0",
        populationSql: "series_number IS NOT NULL AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=series',
      },
    ],
  },
  {
    heading: 'Reading record',
    rows: [
      {
        label: 'Finished books have date finished',
        gapSql:        "status = 'finished' AND date_finished IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "status = 'finished' AND COALESCE(archived,0) = 0",
        query:         'tab=finished&missing=date_finished',
        wizardKey:     'date_finished',
      },
      {
        label: 'Finished books have rating',
        gapSql:        "status = 'finished' AND rating IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "status = 'finished' AND COALESCE(archived,0) = 0",
        query:         'tab=finished&missing=rating',
        wizardKey:     'rating',
      },
      {
        label: 'Reading books have recorded progress',
        gapSql:        "status = 'reading' AND COALESCE(current_page, 0) = 0 AND COALESCE(current_minutes, 0) = 0 AND COALESCE(archived,0) = 0",
        populationSql: "status = 'reading' AND COALESCE(archived,0) = 0",
        query:         'tab=reading&missing=progress',
      },
      {
        label: 'Reading books have start date',
        gapSql:        "status = 'reading' AND date_started IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "status = 'reading' AND COALESCE(archived,0) = 0",
        query:         'tab=reading&missing=date_started',
        wizardKey:     'date_started',
      },
      // True conflict: a book can't be both currently owned and
      // previously-owned. Either the previously_owned flag wasn't
      // cleared when the user reacquired, or owned was toggled
      // back on without resetting previously_owned. Population for
      // % purposes is "currently owned books" — they're the cohort
      // that could potentially be in conflict.
      {
        label: 'Owned books not flagged previously-owned',
        gapSql:        "owned = 1 AND previously_owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&previouslyOwned=true',
      },
    ],
  },
  {
    heading: 'Library mechanics',
    rows: [
      {
        label: 'Stories/Anthology books have entries',
        gapSql: `id IN (
          SELECT bt.book_id FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE t.name IN ('Stories', 'Anthology')
        ) AND id NOT IN (SELECT book_id FROM stories) AND COALESCE(archived,0) = 0`,
        populationSql: `id IN (
          SELECT bt.book_id FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE t.name IN ('Stories', 'Anthology')
        ) AND COALESCE(archived,0) = 0`,
        query: 'tab=all&missing=stories',
      },
      {
        label: 'Owned books have a cover',
        gapSql:        "(cover_path IS NULL OR cover_path = '') AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=cover',
        wizardKey:     'cover',
      },
      // Low-res cover audit — file present but under the threshold
      // (40KB) that almost always reads as a bad/replaceable image. The
      // population is books-with-any-cover (not books-overall), so the
      // % clean number reads as "of the covers you have, how many look
      // good." Pairs with missing=cover above.
      {
        label: 'Owned books have a high-res cover',
        gapSql:        "owned = 1 AND cover_path IS NOT NULL AND cover_path != '' AND cover_bytes IS NOT NULL AND cover_bytes < 40000 AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND cover_path IS NOT NULL AND cover_path != '' AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=hi_res_cover',
      },
      {
        label: 'Owned books have format',
        gapSql:        "owned = 1 AND format IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=format',
        wizardKey:     'format',
      },
      // Stories vs Anthology are mutually exclusive per the user's
      // tagging convention (Stories = single-author; Anthology =
      // multi-author). A book wearing both tags is a data error.
      // Population scope is "books that wear at least one of the two
      // tags" — i.e. the cohort eligible to fall into the conflict.
      {
        label: 'Stories and Anthology tags stay exclusive',
        gapSql: `id IN (
          SELECT bt.book_id FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE t.name = 'Stories'
        ) AND id IN (
          SELECT bt.book_id FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE t.name = 'Anthology'
        ) AND COALESCE(archived,0) = 0`,
        populationSql: `id IN (
          SELECT bt.book_id FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE t.name IN ('Stories', 'Anthology')
        ) AND COALESCE(archived,0) = 0`,
        query: 'tab=all&missing=stories_anthology',
      },
    ],
  },
  // Author audits run against the authors table instead of books.
  // Population is "authors with at least one book in the library" —
  // dangling authors (no books) shouldn't contribute work.
  // The path field redirects click-through to /authors with a sort=
  // query so AuthorsIndex floats the gap rows to the top.
  {
    heading: 'Authors',
    from:    'authors',
    path:    '/authors',
    rows: [
      {
        label: 'Authors have bio',
        gapSql:        "(bio IS NULL OR bio = '') AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_bio',
        wizardKey:     'author_bio',
      },
      {
        label: 'Authors have portrait',
        gapSql:        "(photo_path IS NULL OR photo_path = '') AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_photo',
        wizardKey:     'portrait',
      },
      {
        label: 'Authors have birth/death dates',
        gapSql:        "birth_date IS NULL AND death_date IS NULL AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_dates',
        wizardKey:     'author_dates',
      },
      {
        label: 'Authors have gender',
        gapSql:        "gender IS NULL AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_gender',
        wizardKey:     'author_gender',
      },
      // Authors with a birth year more than 110 years ago and no
      // death_date are almost certainly missing a death date rather
      // than living past 110. Parses the leading YYYY out of the
      // birth_date string (handles "1850", "1850-06-27", and BCE
      // negatives — the latter trivially satisfy the threshold).
      // Population: authors with a birth_date set who don't yet have
      // a death_date — i.e. those for whom the question is meaningful.
      // Threshold matches the most-extreme verified human lifespans
      // (oldest documented ages ≈ 117–122), so the audit flags only
      // implausible records, not still-living centenarians.
      {
        label: 'Old-birth authors have death date',
        gapSql:        "birth_date IS NOT NULL AND death_date IS NULL AND CAST(SUBSTR(birth_date, 1, INSTR(birth_date || '-', '-') - 1) AS INTEGER) < CAST(strftime('%Y','now') AS INTEGER) - 110 AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "birth_date IS NOT NULL AND death_date IS NULL AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_dates',
        wizardKey:     'old_birth_death',
      },
      // Heuristic: deceased authors whose bio opens with "X is a/an/the
      // ..." instead of "X was a/an/the ...". The check looks at the first
      // 100 chars for present-tense subject-verb and requires that no
      // 'was' appears in that window — which would mean the opening
      // sentence is already past-tense and any later 'is' refers to a
      // book or concept, not the author. Adding a death_date to a bio
      // written for a living author leaves the opening verbs stale; this
      // row surfaces the few rows that need a manual editorial sweep.
      {
        label: 'Deceased authors have past-tense bio',
        gapSql:
          "death_date IS NOT NULL AND bio IS NOT NULL AND bio != '' "
          + "AND (SUBSTR(bio, 1, 100) LIKE '% is a %' "
          + "  OR SUBSTR(bio, 1, 100) LIKE '% is an %' "
          + "  OR SUBSTR(bio, 1, 100) LIKE '% is the %') "
          + "AND SUBSTR(bio, 1, 100) NOT LIKE '% was %' "
          + "AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql:
          "death_date IS NOT NULL AND bio IS NOT NULL AND bio != '' "
          + "AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query: 'sort=stale_tense',
      },
    ],
  },
];

export function getAudit() {
  let totalGaps = 0;
  let totalPopulation = 0;
  const audit = AUDITS.map(group => {
    const table = group.from || 'books';
    return {
      heading: group.heading,
      rows: group.rows.map(row => {
        const { c: count } = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${row.gapSql}`).get();
        const { c: pop }   = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${row.populationSql}`).get();
        totalGaps       += count;
        totalPopulation += pop;
        return {
          label: row.label,
          count, population: pop,
          query: row.query,
          path: group.path || '/',
          wizardKey: row.wizardKey ?? null,
        };
      }),
    };
  });

  // 100% if there's literally no eligible book in any audit (e.g. an
  // empty library) — avoids dividing by zero and gives the trivially
  // correct answer.
  const auditCleanPct = totalPopulation === 0
    ? 100
    : (1 - totalGaps / totalPopulation) * 100;

  return {
    audit,
    auditSummary: {
      totalGaps,
      totalPopulation,
      cleanPct: auditCleanPct,
      rowCount: AUDITS.reduce((s, g) => s + g.rows.length, 0),
    },
  };
}
