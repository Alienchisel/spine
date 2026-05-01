import db from '../../db.js';

// Table/column names below are hard-coded constants per role — never pass
// user input as config, or this becomes SQL injection.
function syncPeople(bookId, names, { joinTable, peopleTable, fkColumn }) {
  const seen = new Set();
  const unique = (names || []).map(n => n.trim()).filter(n => {
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
