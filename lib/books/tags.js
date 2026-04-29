import db from '../../db.js';
import { VIRTUAL_TAG_RULES } from './filters.js';

export function syncTags(bookId, tagNames) {
  const seen = new Set();
  const unique = tagNames.map(n => n.trim()).filter(n => {
    if (!n) return false;
    const key = n.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  db.prepare('DELETE FROM book_tags WHERE book_id = ?').run(bookId);
  for (const name of unique) {
    let tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name);
    if (!tag) {
      const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
      tag = { id: result.lastInsertRowid };
    }
    db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)').run(bookId, tag.id);
  }
}

export function computeVirtualTags(book) {
  return VIRTUAL_TAG_RULES
    .filter(r => r.test(book))
    .map(r => ({ id: null, name: r.name, virtual: true }));
}
