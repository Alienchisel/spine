import db from '../../db.js';

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
    `SELECT bt.book_id, t.id, t.name FROM tags t JOIN book_tags bt ON bt.tag_id = t.id WHERE bt.book_id IN (${ph}) ORDER BY t.name`
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
