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
  pruneOrphanPeople(peopleTable);
}

export const syncAuthors     = (bookId, names) => syncPeople(bookId, names, { joinTable: 'book_authors',     peopleTable: 'authors',     fkColumn: 'author_id' });
export const syncNarrators   = (bookId, names) => syncPeople(bookId, names, { joinTable: 'book_narrators',   peopleTable: 'narrators',   fkColumn: 'narrator_id' });
export const syncTranslators = (bookId, names) => syncPeople(bookId, names, { joinTable: 'book_translators', peopleTable: 'translators', fkColumn: 'translator_id' });

// Drop people rows that no longer have any join associations. Without
// this step the autocomplete datalists accumulate ghost names left
// behind by every author/narrator/translator removal — a real annoyance
// noticed on 2026-05-14 when fixing #465's editor credit.
//
// Authors are credited at both the book level (book_authors) and the
// story level (story_authors), so the predicate must check both before
// declaring an author orphaned. Narrators and translators have only
// the book-level join.
//
// Alias groups: if pruning reduces a group to a single surviving member,
// dissolve the group (set alias_group_id = NULL on the singleton). This
// mirrors unlinkAuthorAlias's invariant — a one-member group is a
// phantom and would confuse future linkAuthorAliases reads.
export function pruneOrphanPeople(peopleTable) {
  if (peopleTable === 'authors') {
    db.prepare(`
      DELETE FROM authors
      WHERE id NOT IN (SELECT author_id FROM book_authors)
        AND id NOT IN (SELECT author_id FROM story_authors)
    `).run();
    db.prepare(`
      UPDATE authors SET alias_group_id = NULL
      WHERE alias_group_id IN (
        SELECT alias_group_id FROM authors
        WHERE alias_group_id IS NOT NULL
        GROUP BY alias_group_id
        HAVING COUNT(*) = 1
      )
    `).run();
    return;
  }
  if (peopleTable === 'narrators') {
    db.prepare('DELETE FROM narrators WHERE id NOT IN (SELECT narrator_id FROM book_narrators)').run();
    return;
  }
  if (peopleTable === 'translators') {
    db.prepare('DELETE FROM translators WHERE id NOT IN (SELECT translator_id FROM book_translators)').run();
    return;
  }
  throw new Error(`pruneOrphanPeople: unknown peopleTable ${peopleTable}`);
}

// Link two authors as pen-name aliases of the same person. Mirrors the
// linkEditions/work_id pattern on books: members of a group share a non-
// NULL alias_group_id; symmetry is structural (every member sees every
// other via `WHERE alias_group_id = ? AND id != self`). The lower
// group_id wins on group merges so the choice is deterministic.
export function linkAuthorAliases(idA, idB) {
  if (idA === idB) return null;
  const fn = db.transaction(() => {
    const a = db.prepare('SELECT id, alias_group_id FROM authors WHERE id = ?').get(idA);
    const b = db.prepare('SELECT id, alias_group_id FROM authors WHERE id = ?').get(idB);
    if (!a || !b) return null;
    if (a.alias_group_id != null && a.alias_group_id === b.alias_group_id) return true; // already linked
    if (a.alias_group_id == null && b.alias_group_id == null) {
      const next = db.prepare('SELECT COALESCE(MAX(alias_group_id), 0) + 1 AS g FROM authors').get().g;
      db.prepare('UPDATE authors SET alias_group_id = ? WHERE id IN (?, ?)').run(next, idA, idB);
    } else if (a.alias_group_id == null) {
      db.prepare('UPDATE authors SET alias_group_id = ? WHERE id = ?').run(b.alias_group_id, idA);
    } else if (b.alias_group_id == null) {
      db.prepare('UPDATE authors SET alias_group_id = ? WHERE id = ?').run(a.alias_group_id, idB);
    } else {
      const target = Math.min(a.alias_group_id, b.alias_group_id);
      const source = Math.max(a.alias_group_id, b.alias_group_id);
      db.prepare('UPDATE authors SET alias_group_id = ? WHERE alias_group_id = ?').run(target, source);
    }
    return true;
  });
  return fn();
}

// Remove an author from their alias group. If the remaining membership
// drops to one, dissolve the group — a single member is equivalent to
// NULL and would be a phantom group otherwise.
export function unlinkAuthorAlias(id) {
  const fn = db.transaction(() => {
    const author = db.prepare('SELECT id, alias_group_id FROM authors WHERE id = ?').get(id);
    if (!author) return null;
    if (author.alias_group_id == null) return true; // already unlinked, no-op
    const gid = author.alias_group_id;
    db.prepare('UPDATE authors SET alias_group_id = NULL WHERE id = ?').run(id);
    const remaining = db.prepare('SELECT id FROM authors WHERE alias_group_id = ?').all(gid);
    if (remaining.length === 1) {
      db.prepare('UPDATE authors SET alias_group_id = NULL WHERE id = ?').run(remaining[0].id);
    }
    return true;
  });
  return fn();
}

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
  pruneOrphanPeople('authors');
}
