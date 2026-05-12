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

  return { topAuthors, topNarrators, languages };
}
