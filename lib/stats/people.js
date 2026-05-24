import db from '../../db.js';

// Stats about people associated with books. Currently authors and narrators
// are summarised here; translators are browseable elsewhere but intentionally
// not included in stats. Also covers the languages of the user's library.
export function getPeopleStats() {
  // Alias-aware top authors: aliased pen-names collapse into one entry
  // representing the same person. The chosen primary byline is the alias
  // with the most books (id ASC as tiebreak), and the count is the sum
  // across the group. aliases_count surfaces "(+N)" on the client so the
  // user knows the bar represents more than one byline.
  const rows = db.prepare(`
    SELECT a.id, a.name, a.alias_group_id, COUNT(DISTINCT ba.book_id) AS book_count
    FROM authors a JOIN book_authors ba ON ba.author_id = a.id
    GROUP BY a.id
  `).all();
  const groupMap = new Map();
  for (const r of rows) {
    const gid = r.alias_group_id ?? `solo-${r.id}`;
    if (!groupMap.has(gid)) groupMap.set(gid, []);
    groupMap.get(gid).push(r);
  }
  const topAuthors = Array.from(groupMap.values())
    .map(members => {
      const primary = members.slice().sort((a, b) => (b.book_count - a.book_count) || (a.id - b.id))[0];
      const total = members.reduce((sum, m) => sum + m.book_count, 0);
      return { author_id: primary.id, author: primary.name, count: total, aliases_count: members.length - 1 };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Most-loved authors: same alias-aware shape as topAuthors, but each
  // author's count is the number of their books flagged loved. A derived
  // "favorite authors" surface that piggybacks on existing per-book love
  // signal rather than introducing an explicit author-level flag.
  const lovedRows = db.prepare(`
    SELECT a.id, a.name, a.alias_group_id, COUNT(DISTINCT b.id) AS loved_count
    FROM authors a
    JOIN book_authors ba ON ba.author_id = a.id
    JOIN books b         ON b.id = ba.book_id
    WHERE b.loved = 1
    GROUP BY a.id
  `).all();
  const lovedGroupMap = new Map();
  for (const r of lovedRows) {
    const gid = r.alias_group_id ?? `solo-${r.id}`;
    if (!lovedGroupMap.has(gid)) lovedGroupMap.set(gid, []);
    lovedGroupMap.get(gid).push(r);
  }
  const topLovedAuthors = Array.from(lovedGroupMap.values())
    .map(members => {
      const primary = members.slice().sort((a, b) => (b.loved_count - a.loved_count) || (a.id - b.id))[0];
      const total = members.reduce((sum, m) => sum + m.loved_count, 0);
      return { author_id: primary.id, author: primary.name, count: total, aliases_count: members.length - 1 };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const topNarrators = db.prepare(`
    SELECT n.name AS narrator, COUNT(DISTINCT bn.book_id) AS count
    FROM narrators n JOIN book_narrators bn ON bn.narrator_id = n.id
    GROUP BY n.id
    ORDER BY count DESC
    LIMIT 10
  `).all();

  const languages = db.prepare(`
    SELECT language, COUNT(*) AS count FROM books
    WHERE language IS NOT NULL
    GROUP BY language ORDER BY count DESC
  `).all();

  // Author-gender breakdown. Counts each author once regardless of how
  // many books they have, so a single prolific author doesn't swamp the
  // slice. NULL is surfaced as its own "unassigned" bucket so the user
  // can see how much of the library is still untagged — backfilling is
  // optional, not mandatory. The four keys are a fixed contract; the
  // Stats page's section is gated on them existing.
  const genderRows = db.prepare(`
    SELECT COALESCE(gender, 'unassigned') AS bucket, COUNT(*) AS count
    FROM authors
    GROUP BY bucket
  `).all();
  const authorsByGender = { male: 0, female: 0, other: 0, unassigned: 0 };
  for (const r of genderRows) authorsByGender[r.bucket] = r.count;

  return { topAuthors, topLovedAuthors, topNarrators, languages, authorsByGender };
}
