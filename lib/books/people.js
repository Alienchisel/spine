import db from '../../db.js';

export function syncAuthors(bookId, names) {
  const seen = new Set();
  const unique = (names || []).map(n => n.trim()).filter(n => {
    if (!n) return false;
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  db.prepare('DELETE FROM book_authors WHERE book_id = ?').run(bookId);
  unique.forEach((name, position) => {
    let row = db.prepare('SELECT id FROM authors WHERE name = ? COLLATE NOCASE').get(name);
    if (!row) row = { id: db.prepare('INSERT INTO authors (name) VALUES (?)').run(name).lastInsertRowid };
    db.prepare('INSERT OR IGNORE INTO book_authors (book_id, author_id, position) VALUES (?, ?, ?)').run(bookId, row.id, position);
  });
}

export function syncNarrators(bookId, names) {
  const seen = new Set();
  const unique = (names || []).map(n => n.trim()).filter(n => {
    if (!n) return false;
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  db.prepare('DELETE FROM book_narrators WHERE book_id = ?').run(bookId);
  unique.forEach((name, position) => {
    let row = db.prepare('SELECT id FROM narrators WHERE name = ? COLLATE NOCASE').get(name);
    if (!row) row = { id: db.prepare('INSERT INTO narrators (name) VALUES (?)').run(name).lastInsertRowid };
    db.prepare('INSERT OR IGNORE INTO book_narrators (book_id, narrator_id, position) VALUES (?, ?, ?)').run(bookId, row.id, position);
  });
}

export function syncTranslators(bookId, names) {
  const seen = new Set();
  const unique = (names || []).map(n => n.trim()).filter(n => {
    if (!n) return false;
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  db.prepare('DELETE FROM book_translators WHERE book_id = ?').run(bookId);
  unique.forEach((name, position) => {
    let row = db.prepare('SELECT id FROM translators WHERE name = ? COLLATE NOCASE').get(name);
    if (!row) row = { id: db.prepare('INSERT INTO translators (name) VALUES (?)').run(name).lastInsertRowid };
    db.prepare('INSERT OR IGNORE INTO book_translators (book_id, translator_id, position) VALUES (?, ?, ?)').run(bookId, row.id, position);
  });
}
