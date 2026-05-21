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
        label: 'Owned books missing acquisition date',
        gapSql:        "owned = 1 AND COALESCE(is_custom,0) = 0 AND acquisition_date IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=acquired',
      },
      {
        label: 'Owned books missing acquisition source',
        gapSql:        "owned = 1 AND COALESCE(is_custom,0) = 0 AND (acquisition_source IS NULL OR acquisition_source = '') AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=source',
      },
    ],
  },
  {
    heading: 'Physical books',
    rows: [
      {
        label: 'Physical books missing binding',
        gapSql:        "format = 'physical' AND (binding IS NULL OR binding = '') AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=physical&missing=binding',
      },
      {
        label: 'Owned physical books missing shelf location',
        gapSql:        "format = 'physical' AND shelf_id IS NULL AND unit_id IS NULL AND room_id IS NULL AND building_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=location',
      },
      {
        label: 'Owned physical books missing condition',
        gapSql:        "format = 'physical' AND (condition IS NULL OR condition = '') AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=condition',
      },
      {
        label: 'Shelved books missing shelf position',
        gapSql:        "shelf_id IS NOT NULL AND shelf_position IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "shelf_id IS NOT NULL AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=position',
      },
      // year_edition (the printing year, distinct from year_published)
      // feeds the Antique / Vintage virtual tags. Missing it on a
      // physical book means those tags can't fire.
      {
        label: 'Owned physical books missing year_edition',
        gapSql:        "format = 'physical' AND year_edition IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=year_edition',
      },
      // Strict-cascade placement audits. Each catches owned physical
      // books pinned AT a specific level, with the next-finer level
      // unspecified. The four "missing=location" + these three rows
      // + missing=position partition the shelving curation surface.
      {
        label: 'Books pinned only to a building (no room)',
        gapSql:        "format = 'physical' AND building_id IS NOT NULL AND room_id IS NULL AND unit_id IS NULL AND shelf_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=room',
      },
      {
        label: 'Books pinned only to a room (no shelving unit)',
        gapSql:        "format = 'physical' AND room_id IS NOT NULL AND unit_id IS NULL AND shelf_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=unit',
      },
      {
        label: 'Books pinned only to a unit (no shelf)',
        gapSql:        "format = 'physical' AND unit_id IS NOT NULL AND shelf_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "format = 'physical' AND owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&formats=physical&missing=shelf',
      },
      // Books pointing to a non-existent shelf/unit/room/building.
      // FK SET NULL / CASCADE should prevent this normally; the audit
      // is a defensive integrity check.
      {
        label: 'Books pinned to a deleted shelf/unit/room/building (orphan)',
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
        label: 'Audiobooks missing narrator',
        gapSql:        "format = 'audiobook' AND id NOT IN (SELECT book_id FROM book_narrators) AND COALESCE(archived,0) = 0",
        populationSql: "format = 'audiobook' AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=audiobook&missing=narrator',
      },
      {
        label: 'Audiobooks missing duration',
        gapSql:        "format = 'audiobook' AND duration_minutes IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "format = 'audiobook' AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=audiobook&missing=duration',
      },
      // page_count on an audiobook is the print-equivalent length;
      // surfacing it lets cross-format collage / pages-read rankings
      // include audiobooks instead of skipping them.
      {
        label: 'Audiobooks missing page count (cross-format)',
        gapSql:        "format = 'audiobook' AND COALESCE(is_custom,0) = 0 AND page_count IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "format = 'audiobook' AND COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=all&formats=audiobook&missing=page_count',
      },
    ],
  },
  {
    heading: 'Bibliographic',
    rows: [
      {
        label: 'Books missing authors',
        gapSql:        "id NOT IN (SELECT book_id FROM book_authors) AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(archived,0) = 0",
        query:         'tab=all&missing=author',
      },
      {
        label: 'Owned books missing year published',
        gapSql:        "owned = 1 AND year_published IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=year',
      },
      {
        label: 'Translated works missing translator',
        gapSql:        "original_language IS NOT NULL AND original_language != '' AND id NOT IN (SELECT book_id FROM book_translators) AND COALESCE(archived,0) = 0",
        populationSql: "original_language IS NOT NULL AND original_language != '' AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=translator',
      },
      // Reverse of the above: book has a translator but no
      // original_language. Symmetric metadata gap.
      {
        label: 'Books with translator but no original language',
        gapSql:        "id IN (SELECT book_id FROM book_translators) AND (original_language IS NULL OR original_language = '') AND COALESCE(archived,0) = 0",
        populationSql: "id IN (SELECT book_id FROM book_translators) AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=original_language',
      },
      {
        label: 'Printed books missing ISBN',
        gapSql:        "COALESCE(is_custom,0) = 0 AND (format IS NULL OR format NOT IN ('ebook')) AND isbn_10 IS NULL AND isbn_13 IS NULL AND asin IS NULL AND NOT (COALESCE(year_published,0) < 1970 AND COALESCE(year_edition,0) < 1970) AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(is_custom,0) = 0 AND (format IS NULL OR format NOT IN ('ebook')) AND NOT (COALESCE(year_published,0) < 1970 AND COALESCE(year_edition,0) < 1970) AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=isbn',
      },
      {
        label: 'Books missing publisher',
        gapSql:        "COALESCE(is_custom,0) = 0 AND (publisher IS NULL OR publisher = '') AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(is_custom,0) = 0 AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=publisher',
      },
      {
        label: 'Owned books missing language',
        gapSql:        "owned = 1 AND (language IS NULL OR language = '') AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=language',
      },
      {
        label: 'Owned books missing fiction flag',
        gapSql:        "owned = 1 AND fiction IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=fiction',
      },
      {
        label: 'Books missing description',
        gapSql:        "(description IS NULL OR description = '') AND COALESCE(archived,0) = 0",
        populationSql: "COALESCE(archived,0) = 0",
        query:         'tab=all&missing=description',
      },
      {
        label: 'Books with series but no series number',
        gapSql:        "series IS NOT NULL AND series != '' AND series_number IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "series IS NOT NULL AND series != '' AND COALESCE(archived,0) = 0",
        query:         'tab=all&missing=series_number',
      },
      {
        label: 'Books with series number but no series',
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
        label: 'Finished without date finished',
        gapSql:        "status = 'finished' AND date_finished IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "status = 'finished' AND COALESCE(archived,0) = 0",
        query:         'tab=finished&missing=date_finished',
      },
      {
        label: 'Finished without rating',
        gapSql:        "status = 'finished' AND rating IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "status = 'finished' AND COALESCE(archived,0) = 0",
        query:         'tab=finished&missing=rating',
      },
      {
        label: 'Reading without recorded progress',
        gapSql:        "status = 'reading' AND COALESCE(current_page, 0) = 0 AND COALESCE(current_minutes, 0) = 0 AND COALESCE(archived,0) = 0",
        populationSql: "status = 'reading' AND COALESCE(archived,0) = 0",
        query:         'tab=reading&missing=progress',
      },
      {
        label: 'Reading without start date',
        gapSql:        "status = 'reading' AND date_started IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "status = 'reading' AND COALESCE(archived,0) = 0",
        query:         'tab=reading&missing=date_started',
      },
      // True conflict: a book can't be both currently owned and
      // previously-owned. Either the previously_owned flag wasn't
      // cleared when the user reacquired, or owned was toggled
      // back on without resetting previously_owned. Population for
      // % purposes is "currently owned books" — they're the cohort
      // that could potentially be in conflict.
      {
        label: 'owned=1 with previously_owned=1 (conflict)',
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
        label: 'Custom collections with no entries',
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
        label: 'Owned books with no cover',
        gapSql:        "(cover_path IS NULL OR cover_path = '') AND owned = 1 AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=cover',
      },
      {
        label: 'Owned books missing format',
        gapSql:        "owned = 1 AND format IS NULL AND COALESCE(archived,0) = 0",
        populationSql: "owned = 1 AND COALESCE(archived,0) = 0",
        query:         'tab=owned&missing=format',
      },
      // Stories vs Anthology are mutually exclusive per the user's
      // tagging convention (Stories = single-author; Anthology =
      // multi-author). A book wearing both tags is a data error.
      // Population scope is "books that wear at least one of the two
      // tags" — i.e. the cohort eligible to fall into the conflict.
      {
        label: 'Books tagged both Stories AND Anthology (conflict)',
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
        label: 'Authors missing bio',
        gapSql:        "(bio IS NULL OR bio = '') AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_bio',
      },
      {
        label: 'Authors missing portrait',
        gapSql:        "(photo_path IS NULL OR photo_path = '') AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_photo',
      },
      {
        label: 'Authors missing birth/death dates',
        gapSql:        "birth_date IS NULL AND death_date IS NULL AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_dates',
      },
      {
        label: 'Authors missing gender',
        gapSql:        "gender IS NULL AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_gender',
      },
      {
        label: 'Authors not matched to Open Library',
        gapSql:        "(ol_key IS NULL OR ol_key = '') AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_ol',
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
        label: 'Authors with birth >110 years ago and no death date',
        gapSql:        "birth_date IS NOT NULL AND death_date IS NULL AND CAST(SUBSTR(birth_date, 1, INSTR(birth_date || '-', '-') - 1) AS INTEGER) < CAST(strftime('%Y','now') AS INTEGER) - 110 AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        populationSql: "birth_date IS NOT NULL AND death_date IS NULL AND EXISTS (SELECT 1 FROM book_authors ba WHERE ba.author_id = authors.id)",
        query:         'sort=no_dates',
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
