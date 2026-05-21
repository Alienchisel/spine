import db from '../../db.js';

// Curation health. Hidden page at /audit. Single source of truth for the
// counts and the corresponding click-through URLs that land in Library.
//
// Each row's query string is appended to `/library?` on the client, so
// it has to use the same param names Library's filter pipeline accepts
// (see lib/books/filters.js).
//
// The audit is comprehensive: it covers every metadata gap the user
// might want to chase down. Some rows (description, ISBN, publisher
// on third-party listings) often have large counts that aren't fully
// actionable, but they remain useful for ad-hoc cleanup. If a row
// becomes pure noise, drop it — the underlying `missing=` filter
// remains available from the Library filter panel either way.
const AUDITS = [
  {
    heading: 'Acquisition',
    rows: [
      {
        label: 'Owned books missing acquisition date',
        sql:   "owned = 1 AND COALESCE(is_custom,0) = 0 AND acquisition_date IS NULL AND COALESCE(archived,0) = 0",
        query: 'tab=owned&missing=acquired',
      },
      {
        label: 'Owned books missing acquisition source',
        sql:   "owned = 1 AND COALESCE(is_custom,0) = 0 AND (acquisition_source IS NULL OR acquisition_source = '') AND COALESCE(archived,0) = 0",
        query: 'tab=owned&missing=source',
      },
    ],
  },
  {
    heading: 'Physical books',
    rows: [
      {
        label: 'Physical books missing binding',
        sql:   "format = 'physical' AND (binding IS NULL OR binding = '') AND COALESCE(archived,0) = 0",
        query: 'formats=physical&missing=binding',
      },
      {
        label: 'Owned physical books missing shelf location',
        sql:   "format = 'physical' AND shelf_id IS NULL AND unit_id IS NULL AND room_id IS NULL AND building_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        query: 'tab=owned&formats=physical&missing=location',
      },
      {
        label: 'Owned physical books missing condition',
        sql:   "format = 'physical' AND (condition IS NULL OR condition = '') AND owned = 1 AND COALESCE(archived,0) = 0",
        query: 'tab=owned&formats=physical&missing=condition',
      },
      {
        label: 'Shelved books missing shelf position',
        sql:   "shelf_id IS NOT NULL AND shelf_position IS NULL AND COALESCE(archived,0) = 0",
        query: 'missing=position',
      },
    ],
  },
  {
    heading: 'Audiobooks',
    rows: [
      {
        label: 'Audiobooks missing narrator',
        sql:   "format = 'audiobook' AND id NOT IN (SELECT book_id FROM book_narrators) AND COALESCE(archived,0) = 0",
        query: 'formats=audiobook&missing=narrator',
      },
      {
        label: 'Audiobooks missing duration',
        sql:   "format = 'audiobook' AND duration_minutes IS NULL AND COALESCE(archived,0) = 0",
        query: 'formats=audiobook&missing=duration',
      },
      // page_count on an audiobook is the print-equivalent length;
      // surfacing it lets cross-format collage / pages-read rankings
      // include audiobooks instead of skipping them.
      {
        label: 'Audiobooks missing page count (cross-format)',
        sql:   "format = 'audiobook' AND COALESCE(is_custom,0) = 0 AND page_count IS NULL AND COALESCE(archived,0) = 0",
        query: 'formats=audiobook&missing=page_count',
      },
    ],
  },
  {
    heading: 'Bibliographic',
    rows: [
      {
        label: 'Books missing authors',
        sql:   "id NOT IN (SELECT book_id FROM book_authors) AND COALESCE(archived,0) = 0",
        query: 'missing=author',
      },
      {
        label: 'Owned books missing year published',
        sql:   "owned = 1 AND year_published IS NULL AND COALESCE(archived,0) = 0",
        query: 'tab=owned&missing=year',
      },
      {
        label: 'Translated works missing translator',
        sql:   "original_language IS NOT NULL AND original_language != '' AND id NOT IN (SELECT book_id FROM book_translators) AND COALESCE(archived,0) = 0",
        query: 'missing=translator',
      },
      {
        label: 'Printed books missing ISBN',
        sql:   "COALESCE(is_custom,0) = 0 AND (format IS NULL OR format NOT IN ('ebook')) AND isbn_10 IS NULL AND isbn_13 IS NULL AND asin IS NULL AND NOT (COALESCE(year_published,0) < 1970 AND COALESCE(year_edition,0) < 1970) AND COALESCE(archived,0) = 0",
        query: 'missing=isbn',
      },
      {
        label: 'Books missing publisher',
        sql:   "COALESCE(is_custom,0) = 0 AND (publisher IS NULL OR publisher = '') AND COALESCE(archived,0) = 0",
        query: 'missing=publisher',
      },
      {
        label: 'Owned books missing language',
        sql:   "owned = 1 AND (language IS NULL OR language = '') AND COALESCE(archived,0) = 0",
        query: 'tab=owned&missing=language',
      },
      {
        label: 'Owned books missing fiction flag',
        sql:   "owned = 1 AND fiction IS NULL AND COALESCE(archived,0) = 0",
        query: 'tab=owned&missing=fiction',
      },
    ],
  },
  {
    heading: 'Reading record',
    rows: [
      {
        label: 'Finished without date finished',
        sql:   "status = 'finished' AND date_finished IS NULL AND COALESCE(archived,0) = 0",
        query: 'tab=finished&missing=date_finished',
      },
      {
        label: 'Finished without rating',
        sql:   "status = 'finished' AND rating IS NULL AND COALESCE(archived,0) = 0",
        query: 'tab=finished&missing=rating',
      },
      {
        label: 'Reading without recorded progress',
        sql:   "status = 'reading' AND COALESCE(current_page, 0) = 0 AND COALESCE(current_minutes, 0) = 0 AND COALESCE(archived,0) = 0",
        query: 'tab=reading&missing=progress',
      },
      // True conflict: a book can't be both currently owned and
      // previously-owned. Either the previously_owned flag wasn't
      // cleared when the user reacquired, or owned was toggled
      // back on without resetting previously_owned.
      {
        label: 'owned=1 with previously_owned=1 (conflict)',
        sql:   "owned = 1 AND previously_owned = 1 AND COALESCE(archived,0) = 0",
        query: 'tab=owned&previouslyOwned=true',
      },
    ],
  },
  {
    heading: 'Library mechanics',
    rows: [
      {
        label: 'Custom collections with no entries',
        sql: `id IN (
          SELECT bt.book_id FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE t.name IN ('Stories', 'Anthology')
        ) AND id NOT IN (SELECT book_id FROM stories) AND COALESCE(archived,0) = 0`,
        query: 'missing=stories',
      },
      {
        label: 'Owned books with no cover',
        sql:   "(cover_path IS NULL OR cover_path = '') AND owned = 1 AND COALESCE(archived,0) = 0",
        query: 'tab=owned&missing=cover',
      },
      {
        label: 'Owned books missing format',
        sql:   "owned = 1 AND format IS NULL AND COALESCE(archived,0) = 0",
        query: 'tab=owned&missing=format',
      },
    ],
  },
];

export function getAudit() {
  const audit = AUDITS.map(group => ({
    heading: group.heading,
    rows: group.rows.map(row => {
      const { c } = db.prepare(`SELECT COUNT(*) AS c FROM books WHERE ${row.sql}`).get();
      return { label: row.label, count: c, query: row.query };
    }),
  }));
  return { audit };
}
