import db from '../../db.js';

// Table/column names below are hard-coded constants per role — never pass
// user input as config, or this becomes SQL injection.
function syncPeople(bookId, names, { joinTable, peopleTable, fkColumn }) {
  const seen = new Set();
  // Accept either bare name strings or {name} objects (the GET shape). This
  // matters for clients that round-trip a fetched book back through PUT
  // without flattening the joined arrays first.
  const unique = (names || [])
    .map(n => (typeof n === 'string' ? n : (n?.name ?? '')).trim())
    .filter(n => {
      if (!n) return false;
      const key = n.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  db.prepare(`DELETE FROM ${joinTable} WHERE book_id = ?`).run(bookId);
  unique.forEach((name, position) => {
    let row = db.prepare(`SELECT id FROM ${peopleTable} WHERE name = ? COLLATE NOCASE`).get(name);
    if (!row) row = { id: db.prepare(`INSERT INTO ${peopleTable} (name) VALUES (?)`).run(name).lastInsertRowid };
    db.prepare(`INSERT OR IGNORE INTO ${joinTable} (book_id, ${fkColumn}, position) VALUES (?, ?, ?)`).run(bookId, row.id, position);
  });
}

export const syncAuthors     = (bookId, names) => syncPeople(bookId, names, { joinTable: 'book_authors',     peopleTable: 'authors',     fkColumn: 'author_id' });
export const syncNarrators   = (bookId, names) => syncPeople(bookId, names, { joinTable: 'book_narrators',   peopleTable: 'narrators',   fkColumn: 'narrator_id' });
export const syncTranslators = (bookId, names) => syncPeople(bookId, names, { joinTable: 'book_translators', peopleTable: 'translators', fkColumn: 'translator_id' });

// Parallel of syncAuthors for story-level attribution (Layer 2). Reuses
// the shared authors table — a name like "Edogawa Ranpo" inserted as a
// story author is the same row as if it were a book author, so search
// and sort across surfaces stays consistent.
export function syncStoryAuthors(storyId, names) {
  const seen = new Set();
  const unique = (names || [])
    .map(n => (typeof n === 'string' ? n : (n?.name ?? '')).trim())
    .filter(n => {
      if (!n) return false;
      const key = n.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  db.prepare('DELETE FROM story_authors WHERE story_id = ?').run(storyId);
  unique.forEach((name, position) => {
    let row = db.prepare('SELECT id FROM authors WHERE name = ? COLLATE NOCASE').get(name);
    if (!row) row = { id: db.prepare('INSERT INTO authors (name) VALUES (?)').run(name).lastInsertRowid };
    db.prepare('INSERT OR IGNORE INTO story_authors (story_id, author_id, position) VALUES (?, ?, ?)')
      .run(storyId, row.id, position);
  });
}
