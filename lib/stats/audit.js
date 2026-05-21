import db from '../../db.js';

// Curation health: a curated list of completeness gaps that represent
// actual cleanup work. Single source of truth for both the Stats panel
// (counts + links) and the click-through queries that land in Library.
//
// Each row's query string is appended to `/library?` on the client, so
// it has to use the same param names Library's filter pipeline accepts
// (see lib/books/filters.js).
//
// The list is opinionated: we deliberately omit "missing language" /
// "missing publisher" / "missing year_published" because most source
// listings don't carry them, and flagging the gap nags more than it
// helps. If the audit nags, drop the row.
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
        label: 'Physical books missing shelf location',
        sql:   "format = 'physical' AND shelf_id IS NULL AND unit_id IS NULL AND room_id IS NULL AND building_id IS NULL AND owned = 1 AND COALESCE(archived,0) = 0",
        query: 'tab=owned&formats=physical&missing=location',
      },
      {
        label: 'Physical books missing condition',
        sql:   "format = 'physical' AND (condition IS NULL OR condition = '') AND owned = 1 AND COALESCE(archived,0) = 0",
        query: 'tab=owned&formats=physical&missing=condition',
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
