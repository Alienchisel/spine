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
