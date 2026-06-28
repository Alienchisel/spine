import db from '../../db.js';
import { toCoverUrl } from './normalization.js';

// Column list for every endpoint that returns books in list form.
// `description` is excluded because it's the single largest column
// (~400 bytes/book) and no list-view component reads it — BookDetail
// refetches the single-book endpoint when the user lands there.
// Computed once at module load from PRAGMA so future schema additions
// are picked up automatically while description stays excluded.
const LIST_BOOK_COLUMNS = db.prepare('PRAGMA table_info(books)')
  .all()
  .map(r => r.name)
  .filter(c => c !== 'description');
export const LIST_BOOK_SELECT          = LIST_BOOK_COLUMNS.join(', ');
// For queries that alias the books table (e.g. `FROM books b JOIN ...`)
// and would otherwise want `b.*` — prefixes every column so the SELECT
// disambiguates against joined tables that share column names.
export const LIST_BOOK_SELECT_PREFIXED = LIST_BOOK_COLUMNS.map(c => `b.${c}`).join(', ');

// Attach the joined fields BookCard needs (authors, narrators, real tags) to
// a list of book rows. Mirrors the batched-query pattern used by listBooks()
// in repository.js — three IN-list lookups instead of N+1.
//
// translators are intentionally not included: BookCard doesn't render them.
// Virtual tags (Antique / Vintage / Translated / Re-read / Abridged / Long /
// Short) are also skipped — they require year_edition / original_language /
// read_count / abridged columns that the shelf SELECTs don't pull, and
// they're only used for visual badges. The real tags returned here are what
// realTagNames() needs to prevent rate-from-card from wiping them.
export function attachBookCardJoinedFields(books) {
  if (!books.length) return books;
  const ids = books.map(b => b.id);
  const ph  = ids.map(() => '?').join(',');

  const authorRows = db.prepare(
    `SELECT ba.book_id, a.id, a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id WHERE ba.book_id IN (${ph}) ORDER BY ba.position`
  ).all(...ids);
  const narratorRows = db.prepare(
    `SELECT bn.book_id, n.id, n.name FROM narrators n JOIN book_narrators bn ON bn.narrator_id = n.id WHERE bn.book_id IN (${ph}) ORDER BY bn.position`
  ).all(...ids);
  const tagRows = db.prepare(
    `SELECT bt.book_id, t.id, t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (${ph}) ORDER BY nrm(t.name)`
  ).all(...ids);

  const authorMap   = new Map(ids.map(id => [id, []]));
  const narratorMap = new Map(ids.map(id => [id, []]));
  const tagMap      = new Map(ids.map(id => [id, []]));
  for (const r of authorRows)   authorMap.get(r.book_id)?.push({ id: r.id, name: r.name });
  for (const r of narratorRows) narratorMap.get(r.book_id)?.push({ id: r.id, name: r.name });
  for (const r of tagRows)      tagMap.get(r.book_id)?.push({ id: r.id, name: r.name });

  return books.map(b => ({
    ...b,
    authors:   authorMap.get(b.id)   || [],
    narrators: narratorMap.get(b.id) || [],
    tags:      tagMap.get(b.id)      || [],
  }));
}

// Convenience for the route layer: attach BookCard joined fields AND
// normalize cover_path through toCoverUrl in one step. Used by every
// shelf book-list endpoint, where the prior pattern was the same two
// calls byte-identical at five callsites.
export function serveBookCardRows(rows) {
  return attachBookCardJoinedFields(rows).map(b => ({
    ...b,
    cover_path: toCoverUrl(b.cover_path),
  }));
}

// Read aggregates per book — first_started / last_started / first_finished
// / last_finished derived from the `reads` table. These are the canonical
// "when" values for any surface that previously read books.date_started
// or books.date_finished; book columns remain for backward compatibility
// (they carry the *first* read date) but consumers should prefer the
// aggregates here so re-reads are reflected correctly.
//
// Lexical MIN/MAX works for partial-date strings because shorter prefixes
// sort earlier (so '2020' < '2020-05' < '2020-05-15'), which matches the
// "year-only is treated as start-of-period for sorting" rule used
// elsewhere. Null dates are skipped by MIN/MAX automatically.
export function attachReadAggregates(books) {
  if (!books.length) return books;
  const ids = books.map(b => b.id);
  const ph  = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      book_id,
      MIN(date_started)  AS first_started,
      MAX(date_started)  AS last_started,
      MIN(date_finished) AS first_finished,
      MAX(date_finished) AS last_finished,
      COUNT(*)           AS reads_count
    FROM reads
    WHERE book_id IN (${ph})
    GROUP BY book_id
  `).all(...ids);
  const m = new Map(rows.map(r => [r.book_id, r]));
  return books.map(b => {
    const agg = m.get(b.id);
    return {
      ...b,
      first_started:  agg?.first_started  ?? null,
      last_started:   agg?.last_started   ?? null,
      first_finished: agg?.first_finished ?? null,
      last_finished:  agg?.last_finished  ?? null,
      reads_count:    agg?.reads_count    ?? 0,
      // Phase 3 (migration 079) dropped the date_started / date_finished
      // columns from `books`. The fields stay on the API response under
      // their original names — aliased to the latest reads-row dates —
      // so clients that have always read book.date_started /
      // book.date_finished continue to work. The 'latest read' semantic
      // is the right answer for almost every surface that consumed
      // these (sort 'finished' wants the most-recent finish; the
      // MetadataList card wants the most-recent dates; etc). Surfaces
      // that genuinely want the first-read date use first_started /
      // first_finished instead.
      date_started:   agg?.last_started   ?? null,
      date_finished:  agg?.last_finished  ?? null,
    };
  });
}
