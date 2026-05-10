import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { makeApplyMigration } from '../lib/migrations/applyMigration.js';
import { snapshotRowCounts, diffRowCounts } from '../lib/migrations/sanityCheck.js';
import { runMigrations } from '../lib/migrations/runner.js';

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
    const pre  = new Map([['books', 100], ['authors', 50]]);
    const post = new Map([['books', 100], ['authors', 0]]);
    const { wiped } = diffRowCounts(pre, post);
    assert.deepEqual(wiped, ['authors: 50 → 0']);
  });

  it('does not flag a table that is gone post-migration (rename or drop)', () => {
    // The cascade case the check exists for keeps junction tables in
    // place — only their rows vanish. A migration that deliberately
    // drops or renames a table is not the bug we're guarding against.
    const pre  = new Map([['old_table', 50], ['books', 100]]);
    const post = new Map([['books', 100]]);
    const { wiped } = diffRowCounts(pre, post);
    assert.deepEqual(wiped, []);
  });

  it('skips tables that started empty', () => {
    const pre  = new Map([['books', 0]]);
    const post = new Map([['books', 0]]);
    const { wiped } = diffRowCounts(pre, post);
    assert.deepEqual(wiped, []);
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
    const pre = snapshotRowCounts(db);
    assert.equal(pre.get('child'), 4);

    // Cascade: drop parent with FKs ON inside an explicit txn — child rows go.
    db.exec(`
      BEGIN;
      DROP TABLE parent;
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      INSERT INTO parent (id) VALUES (1), (2), (3);
      COMMIT;
    `);

    const post = snapshotRowCounts(db);
    const { wiped } = diffRowCounts(pre, post);
    assert.deepEqual(wiped, ['child: 4 → 0'],
      'sanity check must surface the cascade-style child-row wipe');
  });
});

describe('migration runner end-to-end', () => {
  let scratch;

  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-runner-'));
  });

  after(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  function makeFixture(label, migrations) {
    // Each fixture gets its own subdir so independent tests don't
    // share migration files or snapshot directories.
    const root = fs.mkdtempSync(path.join(scratch, `${label}-`));
    const migDir = path.join(root, 'migrations');
    const snapDir = path.join(root, 'snapshots');
    fs.mkdirSync(migDir);
    for (const [name, sql] of Object.entries(migrations)) {
      fs.writeFileSync(path.join(migDir, name), sql);
    }
    return { root, migDir, snapDir };
  }

  it('snapshots before each pending migration and applies them in order', () => {
    const { migDir, snapDir } = makeFixture('happy-path', {
      '001_init.sql':
        'CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL);',
      '002_seed.sql':
        "INSERT INTO books (title) VALUES ('A'), ('B'), ('C');",
    });
    const dbFile = path.join(snapDir, '..', 'db.sqlite');
    const db = new Database(dbFile);

    runMigrations({ db, migrationsDir: migDir, snapshotDir: snapDir, log: () => {} });

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM books').get().n, 3);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM migrations').get().n, 2,
      'both migrations must be recorded in the migrations table',
    );

    const snapshots = fs.readdirSync(snapDir).sort();
    assert.equal(snapshots.length, 2, 'one snapshot per pending migration');
    assert.ok(snapshots[0].startsWith('spine-pre-001_init-'),
      `expected snapshot for 001_init, got ${snapshots[0]}`);
    assert.ok(snapshots[1].startsWith('spine-pre-002_seed-'),
      `expected snapshot for 002_seed, got ${snapshots[1]}`);
  });

  it('aborts when a migration batch wipes a non-empty table, leaving snapshot for rollback', () => {
    const { migDir, snapDir } = makeFixture('cascade-abort', {
      '001_init.sql': `
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE);
        INSERT INTO parent (id) VALUES (1), (2);
        INSERT INTO child (parent_id) VALUES (1), (1), (2);
      `,
    });
    const dbFile = path.join(snapDir, '..', 'db.sqlite');
    const db = new Database(dbFile);
    db.pragma('foreign_keys = ON');

    // First batch: just create + seed. Succeeds.
    runMigrations({ db, migrationsDir: migDir, snapshotDir: snapDir, log: () => {} });
    assert.equal(db.prepare('SELECT COUNT(*) FROM child').get()['COUNT(*)'], 3);

    // Second batch: an evil migration that empties child via cascade.
    fs.writeFileSync(path.join(migDir, '002_cascade.sql'),
      'DELETE FROM parent;');

    assert.throws(
      () => runMigrations({ db, migrationsDir: migDir, snapshotDir: snapDir, log: () => {} }),
      /wiped non-empty tables.*child: 3 → 0/,
    );

    // The pre-snapshot for the bad migration must be on disk for rollback.
    const snapshots = fs.readdirSync(snapDir);
    const evilSnapshot = snapshots.find(f => f.startsWith('spine-pre-002_cascade-'));
    assert.ok(evilSnapshot, 'bad migration must leave its pre-snapshot on disk');
  });

  it('skips snapshots when isInMemory is true', () => {
    const { migDir, snapDir } = makeFixture('in-memory', {
      '001.sql': 'CREATE TABLE books (id INTEGER PRIMARY KEY);',
    });
    const db = new Database(':memory:');

    runMigrations({
      db, migrationsDir: migDir, snapshotDir: snapDir, isInMemory: true, log: () => {},
    });

    assert.ok(!fs.existsSync(snapDir),
      'in-memory mode must not create the snapshot directory');
  });

  it('prunes snapshots older than retainDays after a successful batch', () => {
    const { migDir, snapDir } = makeFixture('retention', {
      '001.sql': 'CREATE TABLE books (id INTEGER PRIMARY KEY);',
    });
    fs.mkdirSync(snapDir);
    // Plant an "old" pre-snapshot file with backdated mtime.
    const stalePath = path.join(snapDir, 'spine-pre-000_ancient-2025-01-01T00-00-00.db');
    fs.writeFileSync(stalePath, 'fake');
    const stale = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
    fs.utimesSync(stalePath, stale / 1000, stale / 1000);
    // Plant a "recent" pre-snapshot that should survive.
    const freshPath = path.join(snapDir, 'spine-pre-000_recent-2026-05-09T00-00-00.db');
    fs.writeFileSync(freshPath, 'fake');

    const dbFile = path.join(snapDir, '..', 'db.sqlite');
    const db = new Database(dbFile);
    runMigrations({
      db, migrationsDir: migDir, snapshotDir: snapDir, retainDays: 90, log: () => {},
    });

    assert.ok(!fs.existsSync(stalePath), '100-day-old snapshot must be pruned');
    assert.ok(fs.existsSync(freshPath), 'recent snapshot must survive');
  });

  it('is a no-op when there are no pending migrations', () => {
    const { migDir, snapDir } = makeFixture('idempotent', {
      '001.sql': 'CREATE TABLE books (id INTEGER PRIMARY KEY);',
    });
    const dbFile = path.join(snapDir, '..', 'db.sqlite');
    const db = new Database(dbFile);

    runMigrations({ db, migrationsDir: migDir, snapshotDir: snapDir, log: () => {} });
    const firstSnapshots = fs.readdirSync(snapDir);
    assert.equal(firstSnapshots.length, 1, 'first run snapshots');

    // Second run: nothing pending.
    runMigrations({ db, migrationsDir: migDir, snapshotDir: snapDir, log: () => {} });
    const secondSnapshots = fs.readdirSync(snapDir);
    assert.equal(secondSnapshots.length, 1,
      'no-op second run must not create new snapshots');
  });
});
