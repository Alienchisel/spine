import db from '../../db.js';

// Stats about people associated with books. Currently authors and narrators
// are summarised here; translators are browseable elsewhere but intentionally
// not included in stats. Also covers the languages of the user's library.
export function getPeopleStats() {
  const topAuthors = db.prepare(`
    SELECT a.name AS author, COUNT(DISTINCT ba.book_id) AS count
    FROM authors a JOIN book_authors ba ON ba.author_id = a.id
    GROUP BY a.id
    ORDER BY count DESC
    LIMIT 10
  `).all();

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
