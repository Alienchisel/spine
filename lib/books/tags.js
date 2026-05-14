import db from '../../db.js';
import { VIRTUAL_TAG_RULES } from './filters.js';

const VIRTUAL_TAG_NAMES = new Set(VIRTUAL_TAG_RULES.map(r => r.name.toLowerCase()));

export function syncTags(bookId, tagNames) {
  const seen = new Set();
  // Accept either bare strings or {name, virtual} objects (the GET shape).
  // Virtual tags are computed at read time and must never be persisted —
  // skip both objects flagged virtual=true and any name matching a virtual
  // rule, in case a client forgot to filter them on round-trip.
  const unique = (tagNames || [])
    .filter(t => !(t && typeof t === 'object' && t.virtual))
    .map(n => (typeof n === 'string' ? n : (n?.name ?? '')).trim())
    .filter(n => {
      if (!n) return false;
      const key = n.toLowerCase();
      if (VIRTUAL_TAG_NAMES.has(key)) return false;
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
  pruneOrphanTags();
}

// Drop tag rows that no longer carry any book association. Without this
// step removing the last book to use a tag leaves a ghost row visible
// in the tag autocomplete and facet UIs. Counterpart of pruneOrphanPeople
// in people.js — same motivation, same self-contained call from inside
// the corresponding sync.
export function pruneOrphanTags() {
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM book_tags)').run();
}

export function computeVirtualTags(book) {
  return VIRTUAL_TAG_RULES
    .filter(r => r.test(book))
    .map(r => ({ id: null, name: r.name, virtual: true }));
}
