import db from '../../db.js';
import { stripWrap } from './normalization.js';

// Table/column names below are hard-coded constants per role — never pass
// user input as config, or this becomes SQL injection.
function syncPeople(bookId, names, { joinTable, peopleTable, fkColumn }) {
  const seen = new Set();
  // Accept either bare name strings or {name} objects (the GET shape). This
  // matters for clients that round-trip a fetched book back through PUT
  // without flattening the joined arrays first.
  // stripWrap defends against ingest scripts that pass a literal Python
  // repr() of a name into the field — see normalization.js for the
  // originating incident.
  const unique = (names || [])
    .map(n => stripWrap((typeof n === 'string' ? n : (n?.name ?? '')).trim()))
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

// Merge a duplicate author row into a survivor. For ingest-created
// variants (initial-spacing, typos) that are the SAME person twice —
// distinct from alias groups, which model one person with multiple
// deliberate names (pen names). The loser's credits move to the
// survivor; the loser row is deleted.
//
//  - book_authors / story_authors re-point to the survivor. Where the
//    survivor is already credited on the same book/story (both variants
//    bylined together), the loser's join row is dropped instead — the
//    survivor's existing position wins.
//  - Metadata merges non-destructively (COALESCE: survivor's value wins,
//    loser fills blanks) — same rule as the OL refresh. loved is OR'd.
//  - Alias groups: the survivor inherits the loser's group membership,
//    merging groups (lower id wins) if both were grouped. Singleton
//    groups left behind are dissolved.
//  - Returns null if either id is missing, otherwise
//    { orphanPhotoPath } — the loser's photo file when the survivor
//    kept its own; the CALLER deletes it after commit (file I/O stays
//    outside the transaction).
export function mergeAuthors(survivorId, loserId) {
  if (survivorId === loserId) return null;
  const fn = db.transaction(() => {
    const survivor = db.prepare('SELECT * FROM authors WHERE id = ?').get(survivorId);
    const loser    = db.prepare('SELECT * FROM authors WHERE id = ?').get(loserId);
    if (!survivor || !loser) return null;

    for (const [joinTable, keyCol] of [['book_authors', 'book_id'], ['story_authors', 'story_id']]) {
      db.prepare(`
        DELETE FROM ${joinTable}
         WHERE author_id = ?
           AND ${keyCol} IN (SELECT ${keyCol} FROM ${joinTable} WHERE author_id = ?)
      `).run(loserId, survivorId);
      db.prepare(`UPDATE ${joinTable} SET author_id = ? WHERE author_id = ?`).run(survivorId, loserId);
    }

    db.prepare(`
      UPDATE authors SET
        gender            = COALESCE(gender, ?),
        bio               = COALESCE(bio, ?),
        photo_path        = COALESCE(photo_path, ?),
        ol_key            = COALESCE(ol_key, ?),
        bio_fetched_at    = COALESCE(bio_fetched_at, ?),
        birth_date        = COALESCE(birth_date, ?),
        death_date        = COALESCE(death_date, ?),
        default_sort      = COALESCE(default_sort, ?),
        showcase_position = COALESCE(showcase_position, ?),
        loved             = MAX(loved, ?)
      WHERE id = ?
    `).run(
      loser.gender, loser.bio, loser.photo_path, loser.ol_key, loser.bio_fetched_at,
      loser.birth_date, loser.death_date, loser.default_sort, loser.showcase_position,
      loser.loved, survivorId,
    );

    // The loser's photo file orphans when the survivor kept its own.
    const orphanPhotoPath = (survivor.photo_path && loser.photo_path && survivor.photo_path !== loser.photo_path)
      ? loser.photo_path
      : null;

    // Alias-group inheritance mirrors linkAuthorAliases's merge rules.
    if (loser.alias_group_id != null && survivor.alias_group_id == null) {
      db.prepare('UPDATE authors SET alias_group_id = ? WHERE id = ?').run(loser.alias_group_id, survivorId);
    } else if (loser.alias_group_id != null && survivor.alias_group_id != null
               && loser.alias_group_id !== survivor.alias_group_id) {
      const target = Math.min(loser.alias_group_id, survivor.alias_group_id);
      const source = Math.max(loser.alias_group_id, survivor.alias_group_id);
      db.prepare('UPDATE authors SET alias_group_id = ? WHERE alias_group_id = ?').run(target, source);
    }

    db.prepare('DELETE FROM authors WHERE id = ?').run(loserId);
    // Deleting the loser can leave its alias group with one member.
    db.prepare(`
      UPDATE authors SET alias_group_id = NULL
      WHERE alias_group_id IN (
        SELECT alias_group_id FROM authors
        WHERE alias_group_id IS NOT NULL
        GROUP BY alias_group_id
        HAVING COUNT(*) = 1
      )
    `).run();

    return { orphanPhotoPath };
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
    .map(n => stripWrap((typeof n === 'string' ? n : (n?.name ?? '')).trim()))
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
