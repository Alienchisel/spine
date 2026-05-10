import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { makeApplyMigration } from '../lib/migrations/applyMigration.js';
import { snapshotRowCounts, diffRowCounts } from '../lib/migrations/sanityCheck.js';

describe('migration runner', () => {
  // Regression for the 2026-05-09 incident. Migration 053 used the
  // table-rebuild pattern with `PRAGMA foreign_keys = OFF` to relax a
  // CHECK constraint. The runner wrapped every migration in
  // db.transaction(...), and SQLite silently ignores foreign_keys
  // toggling inside an open transaction, so the DROP TABLE cascaded
  // through every junction (book_authors, book_tags, reading_log, ...).
  // The fix: migrations containing `PRAGMA foreign_keys = OFF` bypass
  // the txn wrapper. This test locks that behaviour in.
  it('preserves junction rows when migration toggles PRAGMA foreign_keys', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        rating REAL CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5))
      );
      CREATE TABLE book_authors (
        book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL,
        PRIMARY KEY (book_id, author_id)
      );
      INSERT INTO books (id, title) VALUES (1, 'Test Book'), (2, 'Other Book');
      INSERT INTO book_authors (book_id, author_id) VALUES (1, 10), (1, 11), (2, 12);
    `);

    const apply = makeApplyMigration(db);

    // Mirror the shape of migration 053 — relax the rating CHECK via
    // table rebuild, with FK enforcement disabled so the DROP doesn't
    // cascade through book_authors.
    apply('001_relax_check.sql', `
      PRAGMA foreign_keys = OFF;
      CREATE TABLE books_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        rating REAL CHECK(rating IS NULL OR (rating >= 0.5 AND rating <= 5))
      );
      INSERT INTO books_new SELECT id, title, rating FROM books;
      INSERT OR REPLACE INTO sqlite_sequence (name, seq)
        SELECT 'books', seq FROM sqlite_sequence WHERE name = 'books';
      DROP TABLE books;
      ALTER TABLE books_new RENAME TO books;
      PRAGMA foreign_keys = ON;
    `);

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM book_authors').get().n;
    assert.equal(remaining, 3, 'all junction rows must survive the rebuild');

    const recorded = db.prepare("SELECT name FROM migrations WHERE name = '001_relax_check.sql'").get();
    assert.ok(recorded, 'migration record must be inserted');

    const newCheckAccepts = db.prepare('UPDATE books SET rating = 0.5 WHERE id = 1').run();
    assert.equal(newCheckAccepts.changes, 1, 'rebuilt table accepts 0.5 rating');
  });

  it('rolls back atomically when a non-FK migration fails', () => {
    // Demonstrates the unmodified path: regular migrations still run
    // inside a transaction, so a partial failure leaves the DB clean.
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);`);
    const apply = makeApplyMigration(db);

    assert.throws(() => apply('002_bad.sql', `
      CREATE TABLE foo (id INTEGER PRIMARY KEY);
      INSERT INTO foo (id) VALUES (1);
      THIS IS NOT VALID SQL;
    `), /syntax error|near/);

    const fooExists = db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='foo'"
    ).get().n;
    assert.equal(fooExists, 0, 'failed migration must roll back any partial schema changes');

    const recorded = db.prepare("SELECT COUNT(*) AS n FROM migrations").get().n;
    assert.equal(recorded, 0, 'failed migration must not record itself as applied');
  });

  it('detects PRAGMA foreign_keys disable in OFF / 0 / false forms', () => {
    // SQLite accepts any of these as the "disable" value. The gate
    // must catch all three (case-insensitively, whitespace-varied)
    // or migrations using the numeric/boolean form would silently
    // get the txn-wrapped path and re-trigger the cascade.
    const variants = [
      'PRAGMA foreign_keys = OFF',
      'pragma foreign_keys = off',
      'PRAGMA  foreign_keys=OFF',
      'PRAGMA\tforeign_keys\t=\tOFF',
      'pragma Foreign_Keys = oFf',
      'PRAGMA foreign_keys = 0',
      'pragma foreign_keys=0',
      'PRAGMA foreign_keys = false',
      'PRAGMA foreign_keys = FALSE',
    ];

    for (const variant of variants) {
      const db = new Database(':memory:');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE);
        INSERT INTO parent (id) VALUES (1);
        INSERT INTO child (parent_id) VALUES (1);
      `);
      const apply = makeApplyMigration(db);
      apply(`mig.sql`, `
        ${variant};
        CREATE TABLE parent_new (id INTEGER PRIMARY KEY);
        INSERT INTO parent_new SELECT id FROM parent;
        DROP TABLE parent;
        ALTER TABLE parent_new RENAME TO parent;
        PRAGMA foreign_keys = ON;
      `);
      const surviving = db.prepare('SELECT COUNT(*) AS n FROM child').get().n;
      assert.equal(surviving, 1, `child row must survive variant: ${JSON.stringify(variant)}`);
    }
  });
});

describe('migration sanity check', () => {
  it('flags a non-empty table that was wiped to zero', () => {
    const before = new Map([['books', 100], ['authors', 50]]);
    const after  = new Map([['books', 100], ['authors', 0]]);
    const { wiped, shrunk } = diffRowCounts(before, after);
    assert.deepEqual(wiped, ['authors: 50 → 0']);
    assert.deepEqual(shrunk, []);
  });

  it('does not flag a table that is gone post-migration (rename or drop)', () => {
    // The cascade case the check exists for keeps junction tables in
    // place — only their rows vanish. A migration that deliberately
    // drops or renames a table is not the bug we're guarding against.
    const before = new Map([['old_table', 50], ['books', 100]]);
    const after  = new Map([['books', 100]]);
    const { wiped, shrunk } = diffRowCounts(before, after);
    assert.deepEqual(wiped, []);
    assert.deepEqual(shrunk, []);
  });

  it('flags a >50% shrinkage as a warning, not a wipe', () => {
    const before = new Map([['books', 100]]);
    const after  = new Map([['books', 40]]);
    const { wiped, shrunk } = diffRowCounts(before, after);
    assert.deepEqual(wiped, []);
    assert.deepEqual(shrunk, ['books: 100 → 40']);
  });

  it('skips tables that started empty', () => {
    const before = new Map([['books', 0]]);
    const after  = new Map([['books', 0]]);
    const { wiped, shrunk } = diffRowCounts(before, after);
    assert.deepEqual(wiped, []);
    assert.deepEqual(shrunk, []);
  });

  it('snapshotRowCounts returns counts for user tables only', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY);
      CREATE TABLE books (id INTEGER PRIMARY KEY);
      CREATE TABLE authors (id INTEGER PRIMARY KEY);
      INSERT INTO books (id) VALUES (1), (2);
      INSERT INTO authors (id) VALUES (10);
    `);
    const counts = snapshotRowCounts(db);
    assert.equal(counts.get('books'), 2);
    assert.equal(counts.get('authors'), 1);
    assert.equal(counts.has('migrations'), false, 'migrations table is excluded');
    assert.equal(counts.has('sqlite_sequence'), false, 'sqlite_* tables are excluded');
  });

  it('end-to-end: cascade-style wipe is caught by diffRowCounts', () => {
    // Mirror the 2026-05-09 incident shape inside a single test:
    // populate parent + child, simulate a botched table-rebuild that
    // cascades the child rows away, and verify the diff classifies
    // the child as wiped.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE migrations (id INTEGER PRIMARY KEY);
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE);
      INSERT INTO parent (id) VALUES (1), (2), (3);
      INSERT INTO child (parent_id) VALUES (1), (1), (2), (3);
    `);
    const before = snapshotRowCounts(db);
    assert.equal(before.get('child'), 4);

    // Cascade: drop parent with FKs ON inside an explicit txn — child rows go.
    db.exec(`
      BEGIN;
      DROP TABLE parent;
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      INSERT INTO parent (id) VALUES (1), (2), (3);
      COMMIT;
    `);

    const after = snapshotRowCounts(db);
    const { wiped } = diffRowCounts(before, after);
    assert.deepEqual(wiped, ['child: 4 → 0'],
      'sanity check must surface the cascade-style child-row wipe');
  });
});
