import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTestServer } from './helpers.js';

// Helper for orphan-prune assertions. The test server uses an in-memory
// DB; importing db.js shares that same connection because app.js loads it
// at module init.
async function loadDb() { return (await import('../db.js')).default; }

describe('books', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  async function req(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, body: data };
  }

  describe('GET /api/books', () => {
    it('returns empty list initially', async () => {
      const { status, body } = await req('GET', '/api/books');
      assert.equal(status, 200);
      assert.deepEqual(body.books, []);
      assert.equal(body.total, 0);
    });
  });

  describe('GET /api/books/facets', () => {
    it('surfaces author names in the authors facet', async () => {
      await req('POST', '/api/books', {
        title: 'Dune', authors: ['Frank Herbert'],
      });
      const { status, body } = await req('GET', '/api/books/facets');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.authors));
      assert.ok(body.authors.includes('Frank Herbert'),
        `expected authors facet to include "Frank Herbert", got ${JSON.stringify(body.authors)}`);
    });

    it('surfaces narrator names in the narrators facet', async () => {
      await req('POST', '/api/books', {
        title: 'Audio Book', narrators: ['Stephen Fry'],
      });
      const { status, body } = await req('GET', '/api/books/facets');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.narrators));
      assert.ok(body.narrators.includes('Stephen Fry'),
        `expected narrators facet to include "Stephen Fry", got ${JSON.stringify(body.narrators)}`);
    });

    it('surfaces translator names in the translators facet', async () => {
      await req('POST', '/api/books', {
        title: 'Crime and Punishment',
        translators: ['Constance Garnett'],
      });
      const { status, body } = await req('GET', '/api/books/facets');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.translators));
      assert.ok(body.translators.includes('Constance Garnett'),
        `expected translators facet to include "Constance Garnett", got ${JSON.stringify(body.translators)}`);
    });

    it('surfaces list names (for any list a book belongs to) in the lists facet', async () => {
      const { body: book } = await req('POST', '/api/books', { title: 'Listed Book' });
      const { body: list } = await req('POST', '/api/lists', { name: 'Facet Test List' });
      await req('POST', `/api/lists/${list.id}/books`, { book_id: book.id });
      const { status, body } = await req('GET', '/api/books/facets');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.lists));
      assert.ok(body.lists.includes('Facet Test List'),
        `expected lists facet to include "Facet Test List", got ${JSON.stringify(body.lists)}`);
    });

    it('narrows people facets by an active cross-axis filter (status)', async () => {
      const cases = [
        { role: 'author',     key: 'authors',     reading: 'Mathilde Vendrasco',  other: 'Cassian Wrenly' },
        { role: 'narrator',   key: 'narrators',   reading: 'Esperanza Yulgren',   other: 'Tobin Marclay' },
        { role: 'translator', key: 'translators', reading: 'Wilhelmina Karsdale', other: 'Aurelio Branscombe' },
      ];

      for (const c of cases) {
        await req('POST', '/api/books', {
          title: `Reading ${c.role}`, [c.key]: [c.reading], status: 'reading',
        });
        await req('POST', '/api/books', {
          title: `Unread ${c.role}`, [c.key]: [c.other],
        });
        const { status, body } = await req('GET', '/api/books/facets?status=reading');
        assert.equal(status, 200);
        assert.ok(body[c.key].includes(c.reading),
          `expected status=reading ${c.key} facet to include ${c.role} of a reading book, got ${JSON.stringify(body[c.key])}`);
        assert.ok(!body[c.key].includes(c.other),
          `expected status=reading ${c.key} facet to exclude ${c.role} whose only book is unread, got ${JSON.stringify(body[c.key])}`);
      }
    });

    it('narrows the tags facet by an active cross-axis filter (status, real tags)', async () => {
      await req('POST', '/api/books', {
        title: 'Reading Tagged', tags: ['xaxis-reading-tag'], status: 'reading',
      });
      await req('POST', '/api/books', {
        title: 'Unread Tagged',  tags: ['xaxis-unread-tag'],
      });
      const { status, body } = await req('GET', '/api/books/facets?status=reading');
      assert.equal(status, 200);
      assert.ok(body.tags.includes('xaxis-reading-tag'),
        `expected status=reading tags facet to include reading book's tag, got ${JSON.stringify(body.tags)}`);
      assert.ok(!body.tags.includes('xaxis-unread-tag'),
        `expected status=reading tags facet to exclude tag whose only book is unread, got ${JSON.stringify(body.tags)}`);
    });

    it('exposes hasEmptySource when at least one book has no acquisition_source', async () => {
      // A book with a source set, plus one without, should produce hasEmptySource=true.
      await req('POST', '/api/books', { title: 'Has Source', acquisition_source: 'Audible' });
      await req('POST', '/api/books', { title: 'No Source' });
      const { body } = await req('GET', '/api/books/facets');
      assert.equal(body.hasEmptySource, true,
        `expected hasEmptySource=true when at least one book has no source, got ${JSON.stringify({sources: body.sources, hasEmptySource: body.hasEmptySource})}`);
    });

    it('narrows the languages facet by an active cross-axis filter (status)', async () => {
      // languages facet flattens both `language` and `original_language` into one
      // set, so a single translated reading book is expected to contribute two
      // language entries. An unread book's language stays out of the facet.
      await req('POST', '/api/books', {
        title: 'Reading Translated', language: 'English', original_language: 'German', status: 'reading',
      });
      await req('POST', '/api/books', {
        title: 'Unread Translated',  language: 'English', original_language: 'Russian',
      });
      const { status, body } = await req('GET', '/api/books/facets?status=reading');
      assert.equal(status, 200);
      assert.ok(body.languages.includes('English'),
        `expected status=reading languages facet to include the reading book's language, got ${JSON.stringify(body.languages)}`);
      assert.ok(body.languages.includes('German'),
        `expected status=reading languages facet to include the reading book's original_language, got ${JSON.stringify(body.languages)}`);
      assert.ok(!body.languages.includes('Russian'),
        `expected status=reading languages facet to exclude original_language whose only book is unread, got ${JSON.stringify(body.languages)}`);
    });

    it('narrows the tags facet by an active cross-axis filter (status, virtual tags)', async () => {
      // Abridged: a reading book with abridged=1 should surface the virtual tag.
      await req('POST', '/api/books', {
        title: 'Reading Abridged Book', abridged: true, status: 'reading',
      });
      // Re-read: read_count isn't in the POST writable set, so create then PUT.
      const { body: rereadBook } = await req('POST', '/api/books', {
        title: 'Unread Re-read Book',
      });
      await req('PUT', `/api/books/${rereadBook.id}`, {
        ...rereadBook, read_count: 2, tags: [],
      });
      const { status, body } = await req('GET', '/api/books/facets?status=reading');
      assert.equal(status, 200);
      assert.ok(body.tags.includes('Abridged'),
        `expected status=reading tags facet to include Abridged virtual tag of a reading book, got ${JSON.stringify(body.tags)}`);
      assert.ok(!body.tags.includes('Re-read'),
        `expected status=reading tags facet to exclude Re-read virtual tag whose only book is unread, got ${JSON.stringify(body.tags)}`);
    });
  });

  describe('POST /api/books', () => {
    it('creates a book and returns it', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Dune' });
      assert.equal(status, 201);
      assert.equal(body.title, 'Dune');
      assert.ok(body.id);
      assert.deepEqual(body.tags, []);
    });

    it('creates a book with tags', async () => {
      const { status, body } = await req('POST', '/api/books', {
        title: 'Foundation',
        tags: ['sci-fi', 'classic'],
      });
      assert.equal(status, 201);
      assert.equal(body.tags.length, 2);
      assert.ok(body.tags.some(t => t.name === 'sci-fi'));
      assert.ok(body.tags.some(t => t.name === 'classic'));
    });

    it('rejects missing title', async () => {
      const { status, body } = await req('POST', '/api/books', { author: 'Someone' });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('honors on_readlist on POST and assigns the next readlist_position', async () => {
      // Regression: POST used to silently drop on_readlist because the field
      // isn't in BOOK_TABLE_COLUMNS (it carries the readlist_position
      // side-effect). createBook now mirrors patchBook's enrollment.
      const { body: a } = await req('POST', '/api/books', {
        title: 'wishlist-A ' + Math.random().toString(36).slice(2, 6),
        on_readlist: true,
      });
      const { body: b } = await req('POST', '/api/books', {
        title: 'wishlist-B ' + Math.random().toString(36).slice(2, 6),
        on_readlist: true,
      });
      assert.equal(a.on_readlist, 1);
      assert.equal(b.on_readlist, 1);
      assert.ok(Number.isInteger(a.readlist_position) && a.readlist_position >= 0);
      assert.ok(Number.isInteger(b.readlist_position) && b.readlist_position > a.readlist_position,
        'second wishlist enrollment should land after the first');
    });

    it('does not enroll in readlist when on_readlist is absent or false', async () => {
      const { body: omit } = await req('POST', '/api/books', {
        title: 'no-readlist-1 ' + Math.random().toString(36).slice(2, 6),
      });
      const { body: explicit } = await req('POST', '/api/books', {
        title: 'no-readlist-2 ' + Math.random().toString(36).slice(2, 6),
        on_readlist: false,
      });
      assert.equal(omit.on_readlist, 0);
      assert.equal(omit.readlist_position, null);
      assert.equal(explicit.on_readlist, 0);
      assert.equal(explicit.readlist_position, null);
    });

    it('rejects invalid status', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', status: 'nope' });
      assert.equal(status, 400);
    });

    it('rejects retired "paused" status (1.29.0)', async () => {
      // Paused was retired in favour of the "Recently logged" sort. The
      // ENUM check should now reject it like any other unknown value —
      // ingest scripts and old client builds that POST status:'paused'
      // should fail loudly, not silently insert.
      const { status } = await req('POST', '/api/books', { title: 'Old paused', status: 'paused' });
      assert.equal(status, 400);
    });

    it('rejects invalid ISBN-10', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_10: '123' });
      assert.equal(status, 400);
    });

    it('accepts ISBN-10 with trailing X', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_10: '197470937X' });
      assert.equal(status, 201);
    });

    it('rejects invalid ISBN-13', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_13: '123' });
      assert.equal(status, 400);
    });

    it('rejects impossible date', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', date_started: '2026-99-99' });
      assert.equal(status, 400);
    });

    it('rejects calendar-rollover dates (Feb 31, Apr 31, Feb 29 non-leap)', async () => {
      // Plain new Date('2024-02-31') silently rolls to March 2; we must catch
      // those with component-equality, not just a NaN check.
      for (const bad of ['2024-02-31', '2024-04-31', '2023-02-29', '2024-06-00']) {
        const { status } = await req('POST', '/api/books', { title: 'X', date_started: bad });
        assert.equal(status, 400, `expected 400 for ${bad}`);
      }
    });

    it('accepts Feb 29 in a leap year', async () => {
      const { status } = await req('POST', '/api/books', { title: 'Leap', date_started: '2024-02-29' });
      assert.equal(status, 201);
    });

    it('rejects calendar-rollover acquisition dates', async () => {
      for (const bad of ['2024-02-31', '2024-13-01', '2023-02-29']) {
        const { status } = await req('POST', '/api/books', { title: 'X', acquisition_date: bad });
        assert.equal(status, 400, `expected 400 for ${bad}`);
      }
    });

    it('accepts year-only and year-month acquisition dates', async () => {
      const a = await req('POST', '/api/books', { title: 'Year only', acquisition_date: '1995' });
      assert.equal(a.status, 201);
      const b = await req('POST', '/api/books', { title: 'Year-month', acquisition_date: '1995-06' });
      assert.equal(b.status, 201);
    });

    it('rejects negative, fractional, or non-numeric read_count', async () => {
      // NaN and Infinity are out of scope: JSON.stringify drops them to null
      // before they reach the server, so they can never be the validation target.
      for (const bad of [-1, 1.5, 'abc']) {
        const { status } = await req('POST', '/api/books', { title: 'X', read_count: bad });
        assert.equal(status, 400, `expected 400 for read_count=${String(bad)}`);
      }
    });

    it('PUT persists a valid read_count override', async () => {
      // Creation always starts read_count at 0 (the column isn't in the POST
      // writable set); PUT is the path that honours a manual override.
      const { body: created } = await req('POST', '/api/books', { title: 'Counter' });
      assert.equal(created.read_count, 0);
      const { body: updated } = await req('PUT', `/api/books/${created.id}`, {
        ...created, read_count: 3, tags: [],
      });
      assert.equal(updated.read_count, 3);
    });

    it('rejects bad read_count on PUT (does not corrupt stored value)', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Read counter' });
      const { status } = await req('PUT', `/api/books/${created.id}`, {
        ...created, read_count: -2, tags: [],
      });
      assert.equal(status, 400);
      const { body: refetched } = await req('GET', `/api/books/${created.id}`);
      assert.equal(refetched.read_count, 0);
    });
  });

  describe('GET /api/books/:id', () => {
    it('returns the book', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Neuromancer' });
      const { status, body } = await req('GET', `/api/books/${created.id}`);
      assert.equal(status, 200);
      assert.equal(body.title, 'Neuromancer');
    });

    it('returns 404 for unknown id', async () => {
      const { status } = await req('GET', '/api/books/99999');
      assert.equal(status, 404);
    });

    it('returns 400 for non-integer id', async () => {
      const { status } = await req('GET', '/api/books/abc');
      assert.equal(status, 400);
    });
  });

  describe('GET /api/books/random', () => {
    it('returns the id of an existing non-archived book', async () => {
      // Doesn't add fixtures — the test DB has plenty by this point in
      // the suite. Adding rows here would risk pushing other tests'
      // fixtures past the 200-row cap on `?limit=500` queries. Draw a
      // few times; every result must be a real, non-archived book id.
      for (let i = 0; i < 5; i++) {
        const { status, body } = await req('GET', '/api/books/random');
        assert.equal(status, 200);
        assert.ok(Number.isInteger(body.id) && body.id >= 1);
        const { status: lookup, body: book } = await req('GET', `/api/books/${body.id}`);
        assert.equal(lookup, 200);
        assert.equal(book.archived, 0, 'random draw must not be archived');
      }
    });

    it('?tab=reading restricts the pool to books with status=reading', async () => {
      // Draw a few times; every result must be a reading book.
      for (let i = 0; i < 3; i++) {
        const { status, body } = await req('GET', '/api/books/random?tab=reading');
        if (status === 404) return; // empty pool — accept and skip
        assert.equal(status, 200);
        const { body: book } = await req('GET', `/api/books/${body.id}`);
        assert.equal(book.status, 'reading', `expected status=reading, got ${book.status}`);
      }
    });

    it('returns 404 when the filter matches no books', async () => {
      // A bogus filter value that no book has — the conditions form is
      // valid but matches nothing.
      const { status } = await req('GET', '/api/books/random?field=tag&value=__no_such_tag_zzz__');
      assert.equal(status, 404);
    });
  });

  describe('PUT /api/books/:id', () => {
    it('updates book fields', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Old Title' });
      const { status, body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'New Title',
        status: 'reading',
      });
      assert.equal(status, 200);
      assert.equal(body.title, 'New Title');
      assert.equal(body.status, 'reading');
    });

    it('syncs tags on update', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Tagged Book',
        tags: ['fantasy'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Tagged Book',
        tags: ['sci-fi', 'dystopia'],
      });
      assert.equal(body.tags.length, 2);
      assert.ok(body.tags.every(t => ['sci-fi', 'dystopia'].includes(t.name)));
    });

    it('prunes orphan author rows after a PUT removes the last credit', async () => {
      const db = await loadDb();
      const name = 'Solo Orphan Author ' + Math.random().toString(36).slice(2, 8);
      const { body: created } = await req('POST', '/api/books', {
        title: 'Orphan Author Test', authors: [name],
      });
      try {
        const rowBefore = db.prepare('SELECT id FROM authors WHERE name = ?').get(name);
        assert.ok(rowBefore, 'author row should exist after POST');
        await req('PUT', `/api/books/${created.id}`, {
          title: 'Orphan Author Test', authors: ['Replacement Author'],
        });
        const rowAfter = db.prepare('SELECT id FROM authors WHERE name = ?').get(name);
        assert.equal(rowAfter, undefined, 'author row should be pruned once no book or story credits remain');
      } finally {
        await req('DELETE', `/api/books/${created.id}`);
      }
    });

    it('keeps an author row alive when only book credit is removed but story credit remains', async () => {
      const db = await loadDb();
      const name = 'Story-Only Author ' + Math.random().toString(36).slice(2, 8);
      const { body: created } = await req('POST', '/api/books', {
        title: 'Mixed Credit Test', authors: [name],
      });
      try {
        // Layer 2 credit: the author also appears on a story.
        await req('POST', `/api/books/${created.id}/stories`, { title: 'Story 1', authors: [name] });
        await req('PUT', `/api/books/${created.id}`, {
          title: 'Mixed Credit Test', authors: ['Different Book Author'],
        });
        const row = db.prepare('SELECT id FROM authors WHERE name = ?').get(name);
        assert.ok(row, 'author with surviving story credit must not be pruned');
      } finally {
        await req('DELETE', `/api/books/${created.id}`);
      }
    });

    it('prunes orphan tag rows after a PUT removes the last book using them', async () => {
      const db = await loadDb();
      const tagName = 'orphan-tag-' + Math.random().toString(36).slice(2, 8);
      const { body: created } = await req('POST', '/api/books', {
        title: 'Tag Orphan Test', tags: [tagName],
      });
      try {
        const rowBefore = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
        assert.ok(rowBefore, 'tag row should exist after POST');
        await req('PUT', `/api/books/${created.id}`, {
          title: 'Tag Orphan Test', tags: ['replacement-tag'],
        });
        const rowAfter = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
        assert.equal(rowAfter, undefined, 'tag row should be pruned once no book uses it');
      } finally {
        await req('DELETE', `/api/books/${created.id}`);
      }
    });

    it('prunes orphan people and tags when a book is deleted', async () => {
      const db = await loadDb();
      const authorName = 'Delete-Cascade Author ' + Math.random().toString(36).slice(2, 8);
      const tagName    = 'delete-cascade-tag-' + Math.random().toString(36).slice(2, 8);
      const { body: created } = await req('POST', '/api/books', {
        title: 'Delete Cascade Test', authors: [authorName], tags: [tagName],
      });
      assert.ok(db.prepare('SELECT id FROM authors WHERE name = ?').get(authorName));
      assert.ok(db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName));
      await req('DELETE', `/api/books/${created.id}`);
      assert.equal(db.prepare('SELECT id FROM authors WHERE name = ?').get(authorName), undefined);
      assert.equal(db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName), undefined);
    });

    it('dissolves a phantom alias group when pruning leaves a single member', async () => {
      const db = await loadDb();
      const nameA = 'Alias A ' + Math.random().toString(36).slice(2, 8);
      const nameB = 'Alias B ' + Math.random().toString(36).slice(2, 8);
      const { body: bookA } = await req('POST', '/api/books', { title: 'Alias Test A', authors: [nameA] });
      const { body: bookB } = await req('POST', '/api/books', { title: 'Alias Test B', authors: [nameB] });
      try {
        const a = db.prepare('SELECT id FROM authors WHERE name = ?').get(nameA);
        const b = db.prepare('SELECT id FROM authors WHERE name = ?').get(nameB);
        await req('POST', `/api/authors/${a.id}/alias-link`, { other_id: b.id });
        const grouped = db.prepare('SELECT alias_group_id FROM authors WHERE id = ?').get(a.id);
        assert.ok(grouped.alias_group_id != null, 'precondition: alias group was formed');
        // Remove the credit on A's only book → A becomes orphan → prune deletes A → group has 1 member → dissolve B.
        await req('PUT', `/api/books/${bookA.id}`, { title: 'Alias Test A', authors: ['Different'] });
        assert.equal(db.prepare('SELECT id FROM authors WHERE id = ?').get(a.id), undefined, 'A pruned');
        const bAfter = db.prepare('SELECT alias_group_id FROM authors WHERE id = ?').get(b.id);
        assert.equal(bAfter.alias_group_id, null, 'singleton alias group must be dissolved');
      } finally {
        await req('DELETE', `/api/books/${bookA.id}`);
        await req('DELETE', `/api/books/${bookB.id}`);
      }
    });

    it('returns 404 for unknown id', async () => {
      const { status } = await req('PUT', '/api/books/99999', { title: 'X' });
      assert.equal(status, 404);
    });

    it('does not unlink when PUT keeps cover_path identical', async () => {
      // No-op edit through repository.js:237 — the normalized filename hasn't
      // changed, so shouldDeleteOldFile is false and fs.unlink must not fire.
      const filename = '4444444444-dddddd.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover-noop ' + Math.random().toString(36).slice(2, 6),
        cover_path: `/uploads/${filename}`,
      });
      const unlinkMock = mock.method(fs, 'unlink', (_p, cb) => cb(null));
      try {
        const { status, body } = await req('PUT', `/api/books/${created.id}`, {
          ...created, tags: [],
        });
        assert.equal(status, 200);
        assert.ok(body.cover_path?.endsWith(filename), 'cover_path should round-trip unchanged');
        assert.equal(unlinkMock.mock.callCount(), 0, 'fs.unlink must not fire on identical cover_path');
      } finally {
        unlinkMock.mock.restore();
      }
    });

    it('unlinks the old cover file when PUT clears cover_path to null', async () => {
      // Explicit-clear path through repository.js:254 — sending cover_path:null
      // should unlink the existing file and persist a null cover_path.
      const oldFilename = '3333333333-cccccc.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover-clear ' + Math.random().toString(36).slice(2, 6),
        cover_path: `/uploads/${oldFilename}`,
      });
      const unlinkMock = mock.method(fs, 'unlink', (_p, cb) => cb(null));
      try {
        const { status, body } = await req('PUT', `/api/books/${created.id}`, {
          ...created, cover_path: null, tags: [],
        });
        assert.equal(status, 200);
        assert.equal(body.cover_path, null);
        assert.equal(unlinkMock.mock.callCount(), 1, 'old cover should be unlinked exactly once');
        const unlinkPath = unlinkMock.mock.calls[0].arguments[0];
        assert.ok(unlinkPath.endsWith(oldFilename),
          `expected unlink path to end in ${oldFilename}, got: ${unlinkPath}`);
      } finally {
        unlinkMock.mock.restore();
      }
    });

    it('preserves cover_path and the file on disk when PUT omits the field entirely', async () => {
      // Regression for the 2026-05-10 incident: scripted PUT roundtrips that
      // omitted cover_path were silently nulling the column AND deleteLocalCover()ing
      // the underlying file. Field-absent must be distinguished from explicit-null.
      const filename = '5555555555-eeeeee.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover-absent ' + Math.random().toString(36).slice(2, 6),
        cover_path: `/uploads/${filename}`,
      });
      const unlinkMock = mock.method(fs, 'unlink', (_p, cb) => cb(null));
      try {
        const { cover_path: _omit, ...withoutCover } = created;
        const { status, body } = await req('PUT', `/api/books/${created.id}`, {
          ...withoutCover, tags: [],
        });
        assert.equal(status, 200);
        assert.ok(body.cover_path?.endsWith(filename),
          `expected preserved cover_path to end in ${filename}, got: ${body.cover_path}`);
        assert.equal(unlinkMock.mock.callCount(), 0,
          'fs.unlink must not fire when cover_path is absent from payload');
      } finally {
        unlinkMock.mock.restore();
      }
    });

    it('unlinks the old cover file when PUT swaps cover_path to a different valid filename', async () => {
      // repository.js:254 — when an existing book's cover_path changes from
      // one safe filename to another, the old file is unlinked. fs.unlink is
      // the boundary.
      const oldFilename = '1111111111-aaaaaa.jpg';
      const newFilename = '2222222222-bbbbbb.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover-swap ' + Math.random().toString(36).slice(2, 6),
        cover_path: `/uploads/${oldFilename}`,
      });
      const unlinkMock = mock.method(fs, 'unlink', (_p, cb) => cb(null));
      try {
        const { status } = await req('PUT', `/api/books/${created.id}`, {
          ...created, cover_path: `/uploads/${newFilename}`, tags: [],
        });
        assert.equal(status, 200);
        assert.equal(unlinkMock.mock.callCount(), 1, 'old cover should be unlinked exactly once');
        const unlinkPath = unlinkMock.mock.calls[0].arguments[0];
        assert.ok(unlinkPath.endsWith(oldFilename),
          `expected unlink path to end in ${oldFilename}, got: ${unlinkPath}`);
      } finally {
        unlinkMock.mock.restore();
      }
    });

    it('rejects invalid source_type', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', source_type: 'tertiary' });
      assert.equal(status, 400);
    });

    it('saves and returns fiction flag', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Dune', fiction: true });
      assert.equal(created.fiction, 1);
      const { body } = await req('PUT', `/api/books/${created.id}`, { title: 'Dune', fiction: false });
      assert.equal(body.fiction, 0);
      const { body: cleared } = await req('PUT', `/api/books/${created.id}`, { title: 'Dune' });
      assert.equal(cleared.fiction, null);
    });

    it('saves source_type for non-fiction', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Thucydides', fiction: false, source_type: 'primary' });
      assert.equal(body.fiction, 0);
      assert.equal(body.source_type, 'primary');
    });

    it('accepts integer fiction=0 for source_type gating (GET→PUT roundtrip)', async () => {
      // Stored books carry integer fiction (0/1), so a roundtripped payload
      // (GET → PUT with the same shape) sends fiction:0 not fiction:false.
      // The gate must accept both, otherwise source_type silently drops on
      // every edit of a non-fiction book by an API client that doesn't
      // re-coerce the field.
      const { body } = await req('POST', '/api/books', {
        title: 'Histories', fiction: 0, source_type: 'secondary',
      });
      assert.equal(body.fiction, 0);
      assert.equal(body.source_type, 'secondary');
    });

    it('PUT applies the same source_type gate as POST', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'History', fiction: false, source_type: 'primary',
      });
      assert.equal(created.source_type, 'primary');

      // Editing a non-fiction book to fiction with source_type still set is
      // rejected — the API now refuses to drop the field silently and asks
      // the caller to clear it explicitly.
      const { status: madeFictionStatus } = await req('PUT', `/api/books/${created.id}`, {
        ...created, fiction: true, source_type: 'primary', tags: [],
      });
      assert.equal(madeFictionStatus, 400);

      // Clearing source_type on the same flip succeeds.
      const { body: madeFiction } = await req('PUT', `/api/books/${created.id}`, {
        ...created, fiction: true, source_type: null, tags: [],
      });
      assert.equal(madeFiction.fiction, 1);
      assert.equal(madeFiction.source_type, null);

      // Flipping back to non-fiction lets a fresh source_type persist.
      const { body: backToNonFiction } = await req('PUT', `/api/books/${created.id}`, {
        ...madeFiction, fiction: false, source_type: 'secondary', tags: [],
      });
      assert.equal(backToNonFiction.fiction, 0);
      assert.equal(backToNonFiction.source_type, 'secondary');
    });

    it('rejects source_type when fiction is not false', async () => {
      // Was silently dropped before; now a 400 so the caller knows the
      // field didn't take. Mirrors CoreFields.jsx:64 — the form only sends
      // source_type when fiction === false.
      const fictionBook = await req('POST', '/api/books', {
        title: 'Iliad', fiction: true, source_type: 'primary',
      });
      assert.equal(fictionBook.status, 400);

      const unsetBook = await req('POST', '/api/books', {
        title: 'Mystery Genre', source_type: 'primary',
      });
      assert.equal(unsetBook.status, 400);
    });

    it('accepts a generic `isbn` field, routing by length', async () => {
      // Was silently dropped before because the validator and column
      // writer both read isbn_10 / isbn_13 only. Length-routing matches
      // how listing pages and humans speak about "the ISBN".
      const { body: isbn13 } = await req('POST', '/api/books', {
        title: 'ISBN-13 Book', isbn: '9781614876434',
      });
      assert.equal(isbn13.isbn_13, '9781614876434');
      assert.equal(isbn13.isbn_10, null);

      const { body: isbn10 } = await req('POST', '/api/books', {
        title: 'ISBN-10 Book', isbn: '0691176353',
      });
      assert.equal(isbn10.isbn_10, '0691176353');
      assert.equal(isbn10.isbn_13, null);

      const badIsbn = await req('POST', '/api/books', {
        title: 'Bad ISBN', isbn: '12345',
      });
      assert.equal(badIsbn.status, 400);
    });

    it('saves and returns previously_owned flag', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Sold Book', previously_owned: true });
      assert.equal(status, 201);
      assert.equal(body.previously_owned, 1);
      assert.equal(body.owned, 0);
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, { title: 'Sold Book', previously_owned: false });
      assert.equal(updated.previously_owned, 0);
    });

    it('owned and previously_owned are mutually exclusive', async () => {
      const { body: a } = await req('POST', '/api/books', { title: 'Conflict A', owned: true, previously_owned: true });
      assert.equal(a.owned, 1);       // owned wins
      assert.equal(a.previously_owned, 0);
      const { body: b } = await req('POST', '/api/books', { title: 'Conflict B', owned: true });
      const { body: updated } = await req('PUT', `/api/books/${b.id}`, { title: 'Conflict B', owned: false, previously_owned: true });
      assert.equal(updated.owned, 0);
      assert.equal(updated.previously_owned, 1);
    });

    it('non-owned physical books have condition and shelf data scrubbed', async () => {
      // Mirrors AcquisitionFields.jsx:13 (clears condition + shelf ids on
      // owned-toggle-off) and :44 (hides shelf picker unless owned). Backend
      // gate at lib/books/repository.js prevents direct API calls from
      // bypassing the form's contract — you can't shelve or assess condition
      // on a copy you don't have.
      const { body: bldg } = await req('POST', '/api/shelf/buildings', { name: 'Gate Test Building' });
      const { body: rm }   = await req('POST', '/api/shelf/rooms',     { building_id: bldg.id, name: 'Gate Room' });
      const { body: u }    = await req('POST', '/api/shelf/units',     { room_id: rm.id, name: 'Gate Unit' });
      const { body: sh }   = await req('POST', '/api/shelf/shelves',   { unit_id: u.id, label: 'Gate Shelf' });

      const payload = {
        title: 'Sold Hardcover',
        format: 'physical',
        owned: false,
        previously_owned: true,
        condition: 'fine',
        binding: 'hardcover',
        shelf_id: sh.id,
        unit_id: u.id,
        room_id: rm.id,
        building_id: bldg.id,
      };
      const { status, body } = await req('POST', '/api/books', payload);
      assert.equal(status, 201);
      assert.equal(body.condition, null);
      assert.equal(body.shelf_id, null);
      assert.equal(body.unit_id, null);
      assert.equal(body.room_id, null);
      assert.equal(body.building_id, null);
      // binding is a property of the edition, not the copy — kept regardless of ownership.
      assert.equal(body.binding, 'hardcover');

      // PUT path: same scrub.
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, payload);
      assert.equal(updated.condition, null);
      assert.equal(updated.shelf_id, null);
    });

    it('is_custom forces owned=1, previously_owned=0, and clears acquisition fields', async () => {
      // Mirrors AcquisitionFields.jsx:31-41 — toggling is_custom in the form forces
      // owned and hides/clears the acquisition fields. Backend enforces the same
      // contract so a direct API call can't drift from the form's promises.
      const payload = {
        title: 'Custom Anthology',
        is_custom: true,
        owned: false,
        previously_owned: true,
        acquisition_source: 'Amazon',
        acquisition_date: '2024',
      };
      const { status, body } = await req('POST', '/api/books', payload);
      assert.equal(status, 201);
      assert.equal(body.is_custom, 1);
      assert.equal(body.owned, 1);
      assert.equal(body.previously_owned, 0);
      assert.equal(body.acquisition_source, null);
      assert.equal(body.acquisition_date, null);

      // PUT-path enforcement: same payload via update should land the same way.
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, { ...payload });
      assert.equal(updated.owned, 1);
      assert.equal(updated.previously_owned, 0);
      assert.equal(updated.acquisition_source, null);
      assert.equal(updated.acquisition_date, null);
    });

    it('clears acquisition fields when neither owned nor previously_owned is set', async () => {
      // Mirrors AcquisitionFields.jsx:56 — the form hides the acquisition
      // inputs when (owned || previously_owned) is false, so a book left
      // in that state shouldn't carry acquisition data the user can no
      // longer see or edit. Server-side normalisation, parallel to the
      // is_custom rule above. Catches the #615 scenario where toggling
      // owned to false left orphaned Kindle/Dec-2018 data behind.
      //
      // One fixture, three transitions — keeps the in-memory DB lean so
      // the result-limited tests downstream don't get squeezed past the
      // 200-cap by extra fixtures.
      const { body: owned } = await req('POST', '/api/books', {
        title: 'Acquisition Gate ' + Math.random().toString(36).slice(2, 6),
        owned: true,
        acquisition_source: 'Kindle',
        acquisition_date: '2020-06-15',
      });
      assert.equal(owned.acquisition_source, 'Kindle');
      assert.equal(owned.acquisition_date, '2020-06-15');

      // Owned→previously_owned: data is preserved (you used to have it).
      const { body: prev } = await req('PUT', `/api/books/${owned.id}`, {
        ...owned, owned: false, previously_owned: true,
      });
      assert.equal(prev.owned, 0);
      assert.equal(prev.previously_owned, 1);
      assert.equal(prev.acquisition_source, 'Kindle');
      assert.equal(prev.acquisition_date, '2020-06-15');

      // previously_owned→never-owned: server nulls acquisition data the
      // user can no longer see through the UI.
      const { body: orphan } = await req('PUT', `/api/books/${owned.id}`, {
        ...prev, owned: false, previously_owned: false,
      });
      assert.equal(orphan.owned, 0);
      assert.equal(orphan.previously_owned, 0);
      assert.equal(orphan.acquisition_source, null);
      assert.equal(orphan.acquisition_date, null);
    });

    it('saves and returns ASIN', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Audible Book', asin: 'B01N4P45MO' });
      assert.equal(status, 201);
      assert.equal(body.asin, 'B01N4P45MO');
    });

    it('rejects invalid ASIN', async () => {
      const { status } = await req('POST', '/api/books', { title: 'Bad ASIN', asin: '123' });
      assert.equal(status, 400);
    });

    it('accepts half-star rating', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Half Star', rating: 3.5 });
      assert.equal(status, 201);
      assert.equal(body.rating, 3.5);
    });

    it('accepts 0.5 rating (the lowest half-step)', async () => {
      // Migration 053 relaxed the books CHECK from `rating >= 1` to
      // `rating >= 0.5`, bringing books in line with stories (which
      // had no CHECK) and with the half-stars convention used across
      // the UI. Before 053 this insert would fail at the DB layer
      // even though the JS validator allowed it.
      const { status, body } = await req('POST', '/api/books', { title: 'Half Star Min', rating: 0.5 });
      assert.equal(status, 201);
      assert.equal(body.rating, 0.5);
    });

    it('rejects non-half-increment rating', async () => {
      const { status } = await req('POST', '/api/books', { title: 'Bad Rating', rating: 3.3 });
      assert.equal(status, 400);
    });

    it('saves and returns year_approximate flag', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Old Book', year_published: 1900, year_approximate: true });
      assert.equal(status, 201);
      assert.equal(body.year_published, 1900);
      assert.equal(body.year_approximate, 1);
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, { title: 'Old Book', year_published: 1900, year_approximate: false });
      assert.equal(updated.year_approximate, 0);
    });

    it('accepts negative year_published for BCE works', async () => {
      const { status, body } = await req('POST', '/api/books', {
        title: 'Iliad', year_published: -800, year_approximate: true,
      });
      assert.equal(status, 201);
      assert.equal(body.year_published, -800);
      assert.equal(body.year_approximate, 1);
    });

    it('rejects year_published of 0 (no year zero on the proleptic calendar)', async () => {
      const { status } = await req('POST', '/api/books', { title: 'Year Zero', year_published: 0 });
      assert.equal(status, 400);
    });

    it('saves and returns abridged flag', async () => {
      const { status, body } = await req('POST', '/api/books', { title: 'Short Cut', abridged: true });
      assert.equal(status, 201);
      assert.equal(body.abridged, 1);
      const { body: updated } = await req('PUT', `/api/books/${body.id}`, { title: 'Short Cut', abridged: false });
      assert.equal(updated.abridged, 0);
    });

    it('defaults abridged to 0 when omitted', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Full Length' });
      assert.equal(body.abridged, 0);
    });

    it('surfaces Abridged as a virtual tag and filters by it', async () => {
      const { body: abridgedBook } = await req('POST', '/api/books', { title: 'Cliffs Edition', abridged: true });
      const { body: fullBook }     = await req('POST', '/api/books', { title: 'Full Edition',   abridged: false });
      // Virtual tag appears on the abridged book and not on the full one.
      assert.ok(abridgedBook.tags.some(t => t.name === 'Abridged' && t.virtual === true),
        'expected Abridged virtual tag on abridged book');
      assert.ok(!fullBook.tags.some(t => t.name === 'Abridged'),
        'expected no Abridged tag on full-length book');
      // Filter by virtual tag: returns the abridged book, excludes the full one.
      const { body: filtered } = await req('GET', '/api/books?tags[]=Abridged');
      const ids = filtered.books.map(b => b.id);
      assert.ok(ids.includes(abridgedBook.id), 'expected abridged book in filtered result');
      assert.ok(!ids.includes(fullBook.id),    'expected full book excluded from filtered result');
    });
  });

  describe('PATCH /api/books/:id', () => {
    it('updates current_page', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Progress Book' });
      const { status, body } = await req('PATCH', `/api/books/${created.id}`, { current_page: 42 });
      assert.equal(status, 200);
      assert.equal(body.current_page, 42);
    });

    it('updates current_minutes', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Audio Book' });
      const { status, body } = await req('PATCH', `/api/books/${created.id}`, { current_minutes: 120 });
      assert.equal(status, 200);
      assert.equal(body.current_minutes, 120);
    });

    it('rejects negative page number', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Bad Page' });
      const { status } = await req('PATCH', `/api/books/${created.id}`, { current_page: -1 });
      assert.equal(status, 400);
    });

    it('rejects current_page above page_count', async () => {
      // Common finger-fumble: typing pages-remaining instead of pages-read,
      // pasting from another book's note. Bound at the route layer so 110%
      // progress can't land in the DB.
      const { body: created } = await req('POST', '/api/books', { title: 'Bounded Page', page_count: 240 });
      const over = await req('PATCH', `/api/books/${created.id}`, { current_page: 241 });
      assert.equal(over.status, 400);
      const equal = await req('PATCH', `/api/books/${created.id}`, { current_page: 240 });
      assert.equal(equal.status, 200, 'current_page == page_count is finished, not over');
    });

    it('rejects current_minutes above duration_minutes', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Bounded Audio', format: 'audiobook', duration_minutes: 600 });
      const over = await req('PATCH', `/api/books/${created.id}`, { current_minutes: 601 });
      assert.equal(over.status, 400);
      const equal = await req('PATCH', `/api/books/${created.id}`, { current_minutes: 600 });
      assert.equal(equal.status, 200);
    });

    it('accepts any non-negative current_page when page_count is unknown', async () => {
      // null page_count means "we don't know the bound" — accept any value
      // rather than blocking progress on an unknowable upper limit.
      const { body: created } = await req('POST', '/api/books', { title: 'Unknown Length' });
      const { status } = await req('PATCH', `/api/books/${created.id}`, { current_page: 9999 });
      assert.equal(status, 200);
    });

    it('rejects blank progress values', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Blank Progress' });
      const page = await req('PATCH', `/api/books/${created.id}`, { current_page: '' });
      assert.equal(page.status, 400);
      const minutes = await req('PATCH', `/api/books/${created.id}`, { current_minutes: '' });
      assert.equal(minutes.status, 400);
    });

    it('coerces numeric strings for progress values', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'String Progress' });
      const { status, body } = await req('PATCH', `/api/books/${created.id}`, { current_page: '12', current_minutes: '30' });
      assert.equal(status, 200);
      assert.equal(body.current_page, 12);
      assert.equal(body.current_minutes, 30);
    });

    it('returns 404 for unknown book id', async () => {
      // patchBook() returns null for missing rows; the route maps that to 404.
      const { status, body } = await req('PATCH', '/api/books/999999', { current_page: 1 });
      assert.equal(status, 404);
      assert.equal(body.error, 'Not found');
    });

    it('does not bump updated_at when re-submitting the same current_page', async () => {
      // SQLite datetime('now', 'localtime') is second-precision, so we sleep
      // past the second boundary to make any spurious bump observable. With
      // the no-op guard in patchBook, second.updated_at must equal first's.
      const { body: created } = await req('POST', '/api/books', { title: 'Idempotent Progress' });
      const { body: first }   = await req('PATCH', `/api/books/${created.id}`, { current_page: 50 });
      await new Promise(r => setTimeout(r, 1100));
      const { body: second }  = await req('PATCH', `/api/books/${created.id}`, { current_page: 50 });
      assert.equal(second.current_page, 50);
      assert.equal(second.updated_at, first.updated_at);
    });
  });

  describe('DELETE /api/books/:id', () => {
    it('deletes the book', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'To Delete' });
      const { status } = await req('DELETE', `/api/books/${created.id}`);
      assert.equal(status, 204);
      const { status: getStatus } = await req('GET', `/api/books/${created.id}`);
      assert.equal(getStatus, 404);
    });

    it('returns 404 for unknown id', async () => {
      const { status } = await req('DELETE', '/api/books/99999');
      assert.equal(status, 404);
    });

    it('PUT round-trips object-shape tags and silently drops virtual tags', async () => {
      // syncTags must accept the GET shape (`[{id, name, virtual}, ...]`) and
      // never persist virtual tags even if a client forgets to filter them.
      const { body: created } = await req('POST', '/api/books', {
        title: 'tagroundtrip ' + Math.random().toString(36).slice(2, 6),
        format: 'physical',
        year_edition: 1900, // triggers Antique virtual tag
        tags: ['Sci-Fi'],
      });
      const fetched = await req('GET', `/api/books/${created.id}`);
      // Tag name comparison is case-insensitive — earlier tests in this file
      // may have registered the same tag at any casing (DB lookup is COLLATE
      // NOCASE).
      assert.ok(fetched.body.tags.some(t => t.name.toLowerCase() === 'sci-fi'));
      assert.ok(fetched.body.tags.some(t => t.name === 'Antique' && t.virtual));
      const { status, body } = await req('PUT', `/api/books/${created.id}`, fetched.body);
      assert.equal(status, 200, 'PUT with object-shape tags should not 500');
      // Real tags persist; Antique still appears (virtual computed on read)
      // but was not persisted as a real tag — that would have been the bug.
      const persisted = body.tags.filter(t => !t.virtual).map(t => t.name.toLowerCase());
      assert.deepEqual(persisted, ['sci-fi']);
    });

    it('PUT accepts authors/narrators as either name strings or {name} objects', async () => {
      // Regression: BookCard's auto-finish PUT round-trips a fetched book —
      // including authors/narrators as {name, ...} objects — without flattening.
      // syncPeople and the firstAuthor derivation must handle both shapes.
      const { body: created } = await req('POST', '/api/books', {
        title: 'roundtrip ' + Math.random().toString(36).slice(2, 6),
        format: 'audiobook',
        authors: ['Robert A. Heinlein'],
        narrators: ['Lloyd James'],
      });
      const fetched = await req('GET', `/api/books/${created.id}`);
      // GET returns authors/narrators as object arrays — PUT them back verbatim.
      const { status, body } = await req('PUT', `/api/books/${created.id}`, {
        ...fetched.body,
        status: 'finished',
        date_finished: '2024-06-01',
        tags: [],
      });
      assert.equal(status, 200, 'PUT with object-array people should not 500');
      assert.equal(body.status, 'finished');
      assert.equal(body.authors[0].name, 'Robert A. Heinlein');
      assert.equal(body.narrators[0].name, 'Lloyd James');
    });

    it('PUT/PATCH/DELETE return 400 for malformed book id', async () => {
      // Compact guard test for the main write-route id parsers
      // (routes/books.js:87, :97, :130). Each rejects non-integer / <1 ids
      // before any repository work.
      const cases = [
        { method: 'PUT',    body: { title: 'X' } },
        { method: 'PATCH',  body: { current_page: 1 } },
        { method: 'DELETE', body: undefined },
      ];
      for (const { method, body } of cases) {
        const { status, body: resBody } = await req(method, '/api/books/nope', body);
        assert.equal(status, 400, `${method} should be 400`);
        assert.equal(resBody.error, 'Invalid book id', `${method} should have 'Invalid book id'`);
      }
    });

    it('unlinks the local cover file when deleting a book with a cover', async () => {
      // repository.js:311 calls deleteLocalCover(book.cover_path) after the
      // row is removed. fs.unlink is the boundary — pin that it's called once
      // with the stored bare filename.
      const filename = '1234567890-abcdef.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover-delete ' + Math.random().toString(36).slice(2, 6),
        cover_path: `/uploads/${filename}`,
      });
      const unlinkMock = mock.method(fs, 'unlink', (_p, cb) => cb(null));
      try {
        const { status } = await req('DELETE', `/api/books/${created.id}`);
        assert.equal(status, 204);
        assert.equal(unlinkMock.mock.callCount(), 1, 'cover should be unlinked exactly once');
        const unlinkPath = unlinkMock.mock.calls[0].arguments[0];
        assert.ok(unlinkPath.endsWith(filename),
          `expected unlink path to end in ${filename}, got: ${unlinkPath}`);
      } finally {
        unlinkMock.mock.restore();
      }
    });
  });

  describe('GET /api/books/:id/log', () => {
    it('returns 400 for invalid book id', async () => {
      const { status, body } = await req('GET', '/api/books/nope/log');
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid book id');
    });

    it('returns 200 with [] for a book with no reading-log rows', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'no-log ' + Math.random().toString(36).slice(2, 6),
      });
      const { status, body } = await req('GET', `/api/books/${created.id}/log`);
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('returns 200 with [] for an unknown book id (no existence check)', async () => {
      // The route doesn't probe books table — the reading_log SELECT just
      // matches zero rows. Pinning this avoids accidental 404 regressions.
      const { status, body } = await req('GET', '/api/books/999999/log');
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });
  });

  describe('reads', () => {
    let bookId;

    before(async () => {
      const { body } = await req('POST', '/api/books', { title: 'Read History Book' });
      bookId = body.id;
    });

    it('POST returns 400 for malformed book id', async () => {
      const { status, body } = await req('POST', '/api/books/abc/reads', {
        date_started: '2024-01-01',
      });
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid book id');
    });

    it('POST returns 404 for an unknown book id', async () => {
      const { status, body } = await req('POST', '/api/books/999999/reads', {
        date_started: '2024-01-01',
      });
      assert.equal(status, 404);
      assert.equal(body.error, 'Not found');
    });

    it('returns empty reads list initially', async () => {
      const { status, body } = await req('GET', `/api/books/${bookId}/reads`);
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('creates a read entry', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-01-01',
        date_finished: '2024-01-15',
      });
      assert.equal(status, 201);
      assert.equal(body.date_started, '2024-01-01');
      assert.equal(body.date_finished, '2024-01-15');
      assert.equal(body.book_id, bookId);
    });

    it('creates a read entry with only date_started', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-02-01',
      });
      assert.equal(status, 201);
      assert.equal(body.date_started, '2024-02-01');
      assert.equal(body.date_finished, null);
    });

    it('rejects date_finished before date_started on POST', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-03-15',
        date_finished: '2024-03-01',
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('rejects invalid date on POST', async () => {
      const { status } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-99-99',
      });
      assert.equal(status, 400);
    });

    it('updates a read entry', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-04-01',
      });
      const { status, body } = await req('PUT', `/api/books/${bookId}/reads/${created.id}`, {
        date_started: '2024-04-01',
        date_finished: '2024-04-30',
      });
      assert.equal(status, 200);
      assert.equal(body.date_finished, '2024-04-30');
    });

    it('persists did_not_finish through POST and round-trips it on GET', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-07-01',
        date_finished: '2024-07-15',
        did_not_finish: true,
      });
      assert.equal(created.did_not_finish, 1);
      const { body: list } = await req('GET', `/api/books/${bookId}/reads`);
      const found = list.find(r => r.id === created.id);
      assert.equal(found.did_not_finish, 1);
    });

    it('defaults did_not_finish to 0 when omitted on POST', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_finished: '2024-08-01',
      });
      assert.equal(created.did_not_finish, 0);
    });

    it('PUT toggles did_not_finish on an existing read', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-09-01',
        date_finished: '2024-09-15',
      });
      assert.equal(created.did_not_finish, 0);
      const { body: updated } = await req('PUT', `/api/books/${bookId}/reads/${created.id}`, {
        date_started: '2024-09-01',
        date_finished: '2024-09-15',
        did_not_finish: true,
      });
      assert.equal(updated.did_not_finish, 1);
      // And back off again — the field accepts toggling, not just setting.
      const { body: cleared } = await req('PUT', `/api/books/${bookId}/reads/${created.id}`, {
        date_started: '2024-09-01',
        date_finished: '2024-09-15',
        did_not_finish: false,
      });
      assert.equal(cleared.did_not_finish, 0);
    });

    it('rejects date_finished before date_started on PUT', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2024-05-01',
      });
      const { status, body } = await req('PUT', `/api/books/${bookId}/reads/${created.id}`, {
        date_started: '2024-05-15',
        date_finished: '2024-05-01',
      });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('deletes a read entry', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {
        date_finished: '2024-06-01',
      });
      const { status } = await req('DELETE', `/api/books/${bookId}/reads/${created.id}`);
      assert.equal(status, 204);
    });

    it('returns 404 for unknown read id', async () => {
      const { status } = await req('DELETE', `/api/books/${bookId}/reads/99999`);
      assert.equal(status, 404);
    });

    it('PUT returns 404 for unknown read id', async () => {
      const { status, body } = await req('PUT', `/api/books/${bookId}/reads/99999`, {
        date_started: '2024-06-01',
      });
      assert.equal(status, 404);
      assert.equal(body.error, 'Not found');
    });

    it('returns 400 for non-integer book id on reads', async () => {
      const { status } = await req('GET', '/api/books/abc/reads');
      assert.equal(status, 400);
    });

    it('GET reads returns 200 with [] for an unknown book id (no existence check)', async () => {
      // Mirrors /log and /lists — the SELECT just matches zero rows.
      const { status, body } = await req('GET', '/api/books/999999/reads');
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('PUT/DELETE reads return 400 when either id is malformed', async () => {
      // The compound id guard at routes/books.js:61 and :74 short-circuits
      // before any DB lookup; both ids must be positive integers.
      const cases = [
        { method: 'PUT',    path: '/api/books/abc/reads/1' },
        { method: 'PUT',    path: '/api/books/1/reads/nope' },
        { method: 'DELETE', path: '/api/books/abc/reads/1' },
        { method: 'DELETE', path: '/api/books/1/reads/nope' },
      ];
      for (const { method, path } of cases) {
        const { status, body } = await req(method, path, method === 'PUT' ? {} : undefined);
        assert.equal(status, 400, `${method} ${path} should be 400`);
        assert.equal(body.error, 'Invalid id', `${method} ${path} should have 'Invalid id' error`);
      }
    });

    it('accepts year-only partial date on POST', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_finished: '2018',
      });
      assert.equal(status, 201);
      assert.equal(body.date_finished, '2018');
    });

    it('accepts year-month partial date on POST', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2019-03',
        date_finished: '2019-06',
      });
      assert.equal(status, 201);
      assert.equal(body.date_started, '2019-03');
      assert.equal(body.date_finished, '2019-06');
    });

    it('accepts mixed-precision partial dates on POST', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started: '2020',
        date_finished: '2020-12-15',
      });
      assert.equal(status, 201);
      assert.equal(body.date_started, '2020');
      assert.equal(body.date_finished, '2020-12-15');
    });

    it('accepts partial dates on PUT', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/reads`, {});
      const { status, body } = await req('PUT', `/api/books/${bookId}/reads/${created.id}`, {
        date_finished: '2021',
      });
      assert.equal(status, 200);
      assert.equal(body.date_finished, '2021');
    });

    it('rejects invalid month in partial date on POST', async () => {
      const { status } = await req('POST', `/api/books/${bookId}/reads`, {
        date_finished: '2024-13',
      });
      assert.equal(status, 400);
    });

    it('accepts mixed-precision pair where naive lexical compare would reject', async () => {
      // Regression: lexically '2024' < '2024-06' is true, but semantically
      // started='2024-06' / finished='2024' means "started in June, finished
      // sometime in 2024" — the comparison must use the shared prefix.
      const { status } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started:  '2024-06',
        date_finished: '2024',
      });
      assert.equal(status, 201);
    });

    it('still rejects partial dates that are clearly out of order', async () => {
      const { status } = await req('POST', `/api/books/${bookId}/reads`, {
        date_started:  '2024-06',
        date_finished: '2023',
      });
      assert.equal(status, 400);
    });

    it('POST /:id/reread bumps read_count and inserts a reads row atomically', async () => {
      // Set up a finished book with one read already logged.
      const { body: created } = await req('POST', '/api/books', {
        title: 'Re-read Endpoint Test', status: 'reading',
      });
      await req('PUT', `/api/books/${created.id}`, {
        title: 'Re-read Endpoint Test', status: 'finished',
        date_started: '2024-01-01', date_finished: '2024-01-15',
      });
      // After the finish-transition: read_count=1 + 1 reads row from auto-INSERT.
      const { body: afterFinish } = await req('GET', `/api/books/${created.id}`);
      assert.equal(afterFinish.read_count, 1);
      const { body: readsAfterFinish } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(readsAfterFinish.length, 1);

      // Now log a re-read with a different date range.
      const { status, body } = await req('POST', `/api/books/${created.id}/reread`, {
        date_started: '2025-03-01', date_finished: '2025-03-20',
      });
      assert.equal(status, 200);
      assert.equal(body.read_count, 2, 'response should reflect bumped count');

      const { body: refetched } = await req('GET', `/api/books/${created.id}`);
      assert.equal(refetched.read_count, 2);
      const { body: reads } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(reads.length, 2);
      const newRow = reads.find(r => r.date_started === '2025-03-01');
      assert.ok(newRow, 'new reads row should exist');
      assert.equal(newRow.date_finished, '2025-03-20');
    });

    it('POST /:id/reread accepts no body (date-less re-read)', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Date-less Re-read' });
      const { status, body } = await req('POST', `/api/books/${created.id}/reread`, {});
      assert.equal(status, 200);
      assert.equal(body.read_count, 1);
      const { body: reads } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(reads.length, 1);
      assert.equal(reads[0].date_started, null);
      assert.equal(reads[0].date_finished, null);
    });

    it('POST /:id/reread validates partial dates and ordering', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Re-read Validation' });
      const bad = await req('POST', `/api/books/${created.id}/reread`, { date_started: '2024-13' });
      assert.equal(bad.status, 400);
      const order = await req('POST', `/api/books/${created.id}/reread`, {
        date_started: '2024-06', date_finished: '2023',
      });
      assert.equal(order.status, 400);
      // Mixed-precision pairs that compare equal on shared prefix are accepted.
      const ok = await req('POST', `/api/books/${created.id}/reread`, {
        date_started: '2024-06', date_finished: '2024',
      });
      assert.equal(ok.status, 200);
    });

    it('POST /:id/reread returns 404 for unknown book', async () => {
      const { status } = await req('POST', '/api/books/999999/reread', {});
      assert.equal(status, 404);
    });

    it('POST /:id/reread returns 400 for malformed book id', async () => {
      const { status } = await req('POST', '/api/books/abc/reread', {});
      assert.equal(status, 400);
    });
  });

  describe('stories (collection table-of-contents)', () => {
    let bookId;

    before(async () => {
      const { body } = await req('POST', '/api/books', { title: 'Story Collection' });
      bookId = body.id;
    });

    it('GET returns empty list for a fresh book', async () => {
      const { status, body } = await req('GET', `/api/books/${bookId}/stories`);
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('POST creates a story with default unread status', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'The First Story', position: 1,
      });
      assert.equal(status, 201);
      assert.equal(body.title, 'The First Story');
      assert.equal(body.position, 1);
      assert.equal(body.status, 'unread');
      assert.equal(body.did_not_finish, 0);
      assert.equal(body.date_finished, null);
      assert.equal(body.book_id, bookId);
    });

    it('POST persists status / rating / date_finished / DNF / notes', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'Loaded Story', status: 'finished',
        date_finished: '2024-06-01', rating: 4.5, did_not_finish: false,
        notes: 'Loved it', position: 2,
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'finished');
      assert.equal(body.rating, 4.5);
      assert.equal(body.date_finished, '2024-06-01');
      assert.equal(body.notes, 'Loved it');
    });

    it('POST rejects missing title', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/stories`, { title: '' });
      assert.equal(status, 400);
      assert.ok(body.error);
    });

    it('POST rejects invalid status', async () => {
      const { status } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'Bad status', status: 'paused',
      });
      assert.equal(status, 400);
    });

    it('POST rejects rating outside 0.5–5 in half-step', async () => {
      const { status: s1 } = await req('POST', `/api/books/${bookId}/stories`, { title: 'Low', rating: 0.25 });
      assert.equal(s1, 400);
      const { status: s2 } = await req('POST', `/api/books/${bookId}/stories`, { title: 'High', rating: 6 });
      assert.equal(s2, 400);
      const { status: s3 } = await req('POST', `/api/books/${bookId}/stories`, { title: 'Quarter', rating: 3.25 });
      assert.equal(s3, 400);
    });

    it('POST rejects malformed date_finished', async () => {
      const { status } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'Bad date', date_finished: '2024-99-99',
      });
      assert.equal(status, 400);
    });

    it('POST accepts partial date (year-only) on date_finished', async () => {
      const { status, body } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'Year Only', date_finished: '2018',
      });
      assert.equal(status, 201);
      assert.equal(body.date_finished, '2018');
    });

    it('POST returns 404 for unknown book id', async () => {
      const { status } = await req('POST', '/api/books/999999/stories', { title: 'x' });
      assert.equal(status, 404);
    });

    it('GET returns 200 with [] for an unknown book id (no existence check)', async () => {
      const { status, body } = await req('GET', '/api/books/999999/stories');
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('GET orders by position ASC with NULL positions last', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Order Coll' });
      await req('POST', `/api/books/${b.id}/stories`, { title: 'Third',  position: 3 });
      await req('POST', `/api/books/${b.id}/stories`, { title: 'First',  position: 1 });
      await req('POST', `/api/books/${b.id}/stories`, { title: 'Trailing' });  // no position
      await req('POST', `/api/books/${b.id}/stories`, { title: 'Second', position: 2 });
      const { body: list } = await req('GET', `/api/books/${b.id}/stories`);
      assert.deepEqual(list.map(s => s.title), ['First', 'Second', 'Third', 'Trailing']);
    });

    it('PUT updates an existing story', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'Will Update', status: 'unread',
      });
      const { status, body } = await req('PUT', `/api/books/${bookId}/stories/${created.id}`, {
        title: 'Will Update', status: 'finished', date_finished: '2024-07-01', rating: 5,
      });
      assert.equal(status, 200);
      assert.equal(body.status, 'finished');
      assert.equal(body.rating, 5);
      assert.equal(body.date_finished, '2024-07-01');
    });

    it('DELETE removes the story', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/stories`, { title: 'Will Delete' });
      const { status } = await req('DELETE', `/api/books/${bookId}/stories/${created.id}`);
      assert.equal(status, 204);
      const { body: list } = await req('GET', `/api/books/${bookId}/stories`);
      assert.equal(list.find(s => s.id === created.id), undefined);
    });

    it('returns 404 for unknown story id on PUT and DELETE', async () => {
      const put = await req('PUT', `/api/books/${bookId}/stories/99999`, { title: 'x' });
      assert.equal(put.status, 404);
      const del = await req('DELETE', `/api/books/${bookId}/stories/99999`);
      assert.equal(del.status, 404);
    });

    it('400 for malformed ids', async () => {
      const cases = [
        { method: 'GET',    path: '/api/books/abc/stories' },
        { method: 'POST',   path: '/api/books/abc/stories', body: { title: 'x' } },
        { method: 'PUT',    path: '/api/books/abc/stories/1', body: { title: 'x' } },
        { method: 'PUT',    path: '/api/books/1/stories/nope', body: { title: 'x' } },
        { method: 'DELETE', path: '/api/books/abc/stories/1' },
        { method: 'DELETE', path: '/api/books/1/stories/nope' },
      ];
      for (const { method, path, body } of cases) {
        const r = await req(method, path, body);
        assert.equal(r.status, 400, `${method} ${path}`);
      }
    });

    it('GET /api/books/:id includes a stories array', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Has Stories' });
      await req('POST', `/api/books/${b.id}/stories`, { title: 'S1', position: 1 });
      await req('POST', `/api/books/${b.id}/stories`, { title: 'S2', position: 2 });
      const { body: full } = await req('GET', `/api/books/${b.id}`);
      assert.equal(full.stories.length, 2);
      assert.equal(full.stories[0].title, 'S1');
    });

    it('persists page_start, page_end, and story authors (Layer 2)', async () => {
      const { body: created } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'Layer 2 Story', position: 99,
        page_start: 195, page_end: 226,
        authors: ['Edogawa Ranpo', 'Junji Ito'],
      });
      assert.equal(created.page_start, 195);
      assert.equal(created.page_end, 226);
      assert.deepEqual(created.authors.map(a => a.name), ['Edogawa Ranpo', 'Junji Ito']);

      // GET round-trips them.
      const { body: list } = await req('GET', `/api/books/${bookId}/stories`);
      const fetched = list.find(s => s.id === created.id);
      assert.equal(fetched.page_start, 195);
      assert.equal(fetched.page_end, 226);
      assert.equal(fetched.authors.length, 2);

      // PUT clears authors when [] is sent, and updates page range.
      const { body: cleared } = await req('PUT', `/api/books/${bookId}/stories/${created.id}`, {
        title: 'Layer 2 Story', page_start: 100, page_end: null, authors: [],
      });
      assert.equal(cleared.page_start, 100);
      assert.equal(cleared.page_end, null);
      assert.deepEqual(cleared.authors, []);
    });

    it('rejects non-positive page_start / page_end and reversed range', async () => {
      const r1 = await req('POST', `/api/books/${bookId}/stories`, { title: 'x', page_start: 0 });
      assert.equal(r1.status, 400);
      const r2 = await req('POST', `/api/books/${bookId}/stories`, { title: 'x', page_start: 'abc' });
      assert.equal(r2.status, 400);
      const r3 = await req('POST', `/api/books/${bookId}/stories`, { title: 'x', page_start: 50, page_end: 10 });
      assert.equal(r3.status, 400);
    });

    it('GET /api/books/:id includes per-story authors with stories array', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Anthology', authors: ['House Author'] });
      await req('POST', `/api/books/${b.id}/stories`, {
        title: 'Adapted', authors: ['Original Writer'],
      });
      await req('POST', `/api/books/${b.id}/stories`, { title: 'Default attribution' });
      const { body: full } = await req('GET', `/api/books/${b.id}`);
      assert.equal(full.stories.length, 2);
      const adapted = full.stories.find(s => s.title === 'Adapted');
      assert.equal(adapted.authors[0].name, 'Original Writer');
      const defaulted = full.stories.find(s => s.title === 'Default attribution');
      assert.deepEqual(defaulted.authors, []);
    });

    it('missing=binding surfaces physical books with no binding (audiobook / ebook excluded)', async () => {
      const stem = 'bindfilter' + Math.random().toString(36).slice(2, 6);
      // Physical, no binding — should appear.
      const { body: a } = await req('POST', '/api/books', { title: `${stem}-physical empty`, format: 'physical' });
      // Physical, binding set — should NOT appear.
      const { body: b } = await req('POST', '/api/books', { title: `${stem}-physical full`, format: 'physical', binding: 'hardcover' });
      // Audiobook, no binding — should NOT appear (binding is N/A for audiobooks).
      const { body: c } = await req('POST', '/api/books', { title: `${stem}-audiobook empty`, format: 'audiobook' });
      // Ebook, no binding — should NOT appear (binding is N/A for ebooks).
      const { body: d } = await req('POST', '/api/books', { title: `${stem}-ebook empty`, format: 'ebook' });

      try {
        const { status, body: list } = await req('GET', `/api/books?missing=binding&q=${stem}&limit=200`);
        assert.equal(status, 200);
        const ids = new Set(list.books.map(b => b.id));
        assert.ok(ids.has(a.id), 'physical book without binding should appear');
        assert.ok(!ids.has(b.id), 'physical book with binding must NOT appear');
        assert.ok(!ids.has(c.id), 'audiobook without binding must NOT appear');
        assert.ok(!ids.has(d.id), 'ebook without binding must NOT appear');
      } finally {
        // Clean up so the in-memory test DB doesn't accumulate books past
        // the 200-row cap that downstream sort=author tests rely on.
        for (const id of [a.id, b.id, c.id, d.id]) {
          await req('DELETE', `/api/books/${id}`);
        }
      }
    });

    it('missing=pages / duration / page_count split by format and intent', async () => {
      // Three curation queues with distinct intent:
      //   missing=pages       → non-audiobook with no page_count (print-pages curation).
      //   missing=duration    → audiobook with no duration_minutes (unusable audiobook).
      //   missing=page_count  → page_count missing on any format (cross-format size).
      const stem = 'pagesfilter' + Math.random().toString(36).slice(2, 6);
      // Physical without page_count → in pages + page_count, not duration.
      const { body: a } = await req('POST', '/api/books', { title: `${stem}-phys-nopages`, format: 'physical' });
      // Physical with page_count → in none.
      const { body: b } = await req('POST', '/api/books', { title: `${stem}-phys-full`, format: 'physical', page_count: 300 });
      // Audiobook without duration → in duration; page_count also null so in page_count too.
      const { body: c } = await req('POST', '/api/books', { title: `${stem}-audio-nodur`, format: 'audiobook' });
      // Audiobook with duration but no page_count → in page_count only.
      const { body: d } = await req('POST', '/api/books', { title: `${stem}-audio-nopg`, format: 'audiobook', duration_minutes: 600 });
      // Audiobook fully filled (duration + page_count) → in none.
      const { body: e } = await req('POST', '/api/books', { title: `${stem}-audio-full`, format: 'audiobook', duration_minutes: 600, page_count: 400 });

      try {
        const { body: pages    } = await req('GET', `/api/books?missing=pages&q=${stem}&limit=200`);
        const { body: duration } = await req('GET', `/api/books?missing=duration&q=${stem}&limit=200`);
        const { body: pageCnt  } = await req('GET', `/api/books?missing=page_count&q=${stem}&limit=200`);

        const pagesIds    = new Set(pages.books.map(b => b.id));
        const durationIds = new Set(duration.books.map(b => b.id));
        const pageCntIds  = new Set(pageCnt.books.map(b => b.id));

        // pages: non-audiobook + page_count IS NULL → only a
        assert.ok( pagesIds.has(a.id),    'physical without page_count in pages');
        assert.ok(!pagesIds.has(b.id),    'physical with page_count not in pages');
        assert.ok(!pagesIds.has(c.id),    'audiobook not in pages (format-gated)');
        assert.ok(!pagesIds.has(d.id),    'audiobook not in pages (format-gated)');
        assert.ok(!pagesIds.has(e.id),    'audiobook not in pages (format-gated)');

        // duration: audiobook + duration_minutes IS NULL → only c
        assert.ok(!durationIds.has(a.id), 'physical not in duration (format-gated)');
        assert.ok(!durationIds.has(b.id), 'physical not in duration (format-gated)');
        assert.ok( durationIds.has(c.id), 'audiobook without duration in duration');
        assert.ok(!durationIds.has(d.id), 'audiobook with duration not in duration');
        assert.ok(!durationIds.has(e.id), 'audiobook with duration not in duration');

        // page_count: any format + page_count IS NULL → a, c, d
        assert.ok( pageCntIds.has(a.id),  'physical without page_count in page_count');
        assert.ok(!pageCntIds.has(b.id),  'physical with page_count not in page_count');
        assert.ok( pageCntIds.has(c.id),  'audiobook without page_count in page_count');
        assert.ok( pageCntIds.has(d.id),  'audiobook without page_count in page_count');
        assert.ok(!pageCntIds.has(e.id),  'audiobook with page_count not in page_count');
      } finally {
        for (const id of [a.id, b.id, c.id, d.id, e.id]) {
          await req('DELETE', `/api/books/${id}`);
        }
      }
    });

    it('missing=position surfaces shelved books with no shelf_position', async () => {
      // Books pinned to a shelf but never dragged into order — the
      // "unpositioned tail" at the end of each shelf. Building / room /
      // unit-level pins shouldn't appear (shelf_position is meaningless
      // there). Books that have been reordered (and therefore have a
      // position) shouldn't appear either.
      const stem = 'posfilter' + Math.random().toString(36).slice(2, 6);
      const { body: bld } = await req('POST', '/api/shelf/buildings', { name: `${stem}-building` });
      const { body: rm  } = await req('POST', '/api/shelf/rooms',     { building_id: bld.id, name: `${stem}-room` });
      const { body: un  } = await req('POST', '/api/shelf/units',     { room_id: rm.id, name: `${stem}-unit` });
      const { body: sh  } = await req('POST', '/api/shelf/shelves',   { unit_id: un.id, label: `${stem}-shelf` });

      // Two on the shelf — one will be positioned via reorder, the other won't.
      const { body: unpinned } = await req('POST', '/api/books', { title: `${stem}-unpinned`, format: 'physical', owned: true, shelf_id: sh.id });
      const { body: pinned   } = await req('POST', '/api/books', { title: `${stem}-pinned`,   format: 'physical', owned: true, shelf_id: sh.id });
      // One at unit level, one at building level — neither should appear.
      const { body: atUnit     } = await req('POST', '/api/books', { title: `${stem}-atunit`,     format: 'physical', owned: true, unit_id:     un.id });
      const { body: atBuilding } = await req('POST', '/api/books', { title: `${stem}-atbuilding`, format: 'physical', owned: true, building_id: bld.id });

      // Drag-reorder assigns shelf_position to both ids; we'll then expect
      // only `unpinned` to remain — but we want exactly one positioned
      // book on this shelf for the inverse assertion, so reorder with
      // only `pinned.id`.
      await req('PUT', `/api/shelf/shelves/${sh.id}/order`, { ids: [pinned.id] });

      try {
        const { status, body: list } = await req('GET', `/api/books?missing=position&q=${stem}&limit=200`);
        assert.equal(status, 200);
        const ids = new Set(list.books.map(b => b.id));
        assert.ok( ids.has(unpinned.id),   'shelved book without position should appear');
        assert.ok(!ids.has(pinned.id),     'shelved book with position must NOT appear');
        assert.ok(!ids.has(atUnit.id),     'unit-level book must NOT appear');
        assert.ok(!ids.has(atBuilding.id), 'building-level book must NOT appear');
      } finally {
        // Don't let fixtures drift the row count — sort=author runs with
        // limit=500 against the same DB and the API caps at 200, so a
        // few extra rows can push that test's fixtures off the result.
        for (const b of [unpinned, pinned, atUnit, atBuilding]) {
          await req('DELETE', `/api/books/${b.id}`);
        }
        await req('DELETE', `/api/shelf/buildings/${bld.id}`);
      }
    });

    it('missing=stories surfaces Stories/Anthology-tagged books with no contents', async () => {
      const stem = 'storiesfilter' + Math.random().toString(36).slice(2, 6);
      // Tagged Stories, no contents yet — should appear.
      const { body: a } = await req('POST', '/api/books', { title: `${stem}-Stories empty`, tags: ['Stories'] });
      // Tagged Anthology, no contents yet — should appear.
      const { body: b } = await req('POST', '/api/books', { title: `${stem}-Anthology empty`, tags: ['Anthology'] });
      // Tagged Stories WITH contents — should NOT appear.
      const { body: c } = await req('POST', '/api/books', { title: `${stem}-Stories full`, tags: ['Stories'] });
      await req('POST', `/api/books/${c.id}/stories`, { title: 'has at least one' });
      // No relevant tag — should NOT appear regardless of empty contents.
      const { body: d } = await req('POST', '/api/books', { title: `${stem}-untagged` });

      const { status, body: list } = await req('GET', `/api/books?missing=stories&q=${stem}&limit=200`);
      assert.equal(status, 200);
      const ids = new Set(list.books.map(b => b.id));
      assert.ok(ids.has(a.id), 'Stories-tagged empty collection should appear');
      assert.ok(ids.has(b.id), 'Anthology-tagged empty collection should appear');
      assert.ok(!ids.has(c.id), 'Stories-tagged collection with contents must NOT appear');
      assert.ok(!ids.has(d.id), 'Untagged book must NOT appear');
    });

    it('missing=condition / location / date_finished filter physical-and-finished gaps', async () => {
      const stem = 'auditfilter' + Math.random().toString(36).slice(2, 6);
      // Authors set on every fixture so they don't pile into the
      // empty-author bucket; named with a "ZZZ" prefix so they sort
      // to the very end of every alphabetical author list and don't
      // crowd earlier-letter fixtures off the 200-row limit cap in
      // tests like sort=author further down the file.
      const author = `ZZZ-Auditor ${stem}`;
      // Physical, no condition — should appear in missing=condition.
      const { body: a } = await req('POST', '/api/books', {
        title: `${stem}-no condition`, format: 'physical', binding: 'paperback', owned: true, authors: [author],
      });
      // Physical with condition set — should NOT appear.
      const { body: b } = await req('POST', '/api/books', {
        title: `${stem}-with condition`, format: 'physical', binding: 'paperback', condition: 'new', owned: true, authors: [author],
      });
      // Physical, no shelf/unit/room/building — should appear in missing=location.
      const { body: c } = await req('POST', '/api/books', {
        title: `${stem}-no location`, format: 'physical', binding: 'paperback', owned: true, authors: [author],
      });
      // Audiobook with no condition — must NOT appear in missing=condition
      // (the filter is physical-only).
      const { body: d } = await req('POST', '/api/books', {
        title: `${stem}-audio no cond`, format: 'audiobook', authors: [author],
      });
      // Finished without date_finished — should appear.
      const { body: e } = await req('POST', '/api/books', {
        title: `${stem}-finished nodate`, status: 'finished', authors: [author],
      });
      // Finished with date_finished — should NOT appear.
      const { body: f } = await req('POST', '/api/books', {
        title: `${stem}-finished dated`, status: 'finished', date_finished: '2026-01-15', authors: [author],
      });

      const { body: cond } = await req('GET', `/api/books?missing=condition&q=${stem}&limit=200`);
      const condIds = new Set(cond.books.map(x => x.id));
      assert.ok(condIds.has(a.id), 'physical no-condition should appear');
      assert.ok(condIds.has(c.id), 'physical no-condition (no location) should appear');
      assert.ok(!condIds.has(b.id), 'physical with condition must NOT appear');
      assert.ok(!condIds.has(d.id), 'audiobook must NOT appear in missing=condition');

      const { body: loc } = await req('GET', `/api/books?missing=location&q=${stem}&limit=200`);
      const locIds = new Set(loc.books.map(x => x.id));
      assert.ok(locIds.has(c.id), 'physical with no shelf pin should appear');
      assert.ok(!locIds.has(d.id), 'audiobook must NOT appear in missing=location');

      const { body: fin } = await req('GET', `/api/books?missing=date_finished&q=${stem}&limit=200`);
      const finIds = new Set(fin.books.map(x => x.id));
      assert.ok(finIds.has(e.id), 'finished without date_finished should appear');
      assert.ok(!finIds.has(f.id), 'finished with date_finished must NOT appear');
    });

    it('missing=stories_anthology surfaces the mutually-exclusive tag conflict', async () => {
      // Stem buried after "ZZZ-" so fixtures sort to the end of every
      // alphabetical list (author + title), keeping later sort=author /
      // sort=title tests with their own 200-row caps unaffected.
      const stem = 'ZZZ-tagxor' + Math.random().toString(36).slice(2, 6);
      const author = `ZZZ-TagXor ${stem}`;
      // Tagged with BOTH Stories and Anthology — should appear.
      const { body: both } = await req('POST', '/api/books', {
        title: `${stem}-both`, tags: ['Stories', 'Anthology'], authors: [author],
      });
      // Tagged with only Stories — should NOT appear.
      const { body: storiesOnly } = await req('POST', '/api/books', {
        title: `${stem}-stories`, tags: ['Stories'], authors: [author],
      });
      // Tagged with only Anthology — should NOT appear.
      const { body: anthOnly } = await req('POST', '/api/books', {
        title: `${stem}-anth`, tags: ['Anthology'], authors: [author],
      });
      // Untagged — should NOT appear.
      const { body: untagged } = await req('POST', '/api/books', {
        title: `${stem}-untagged`, authors: [author],
      });

      const { body: list } = await req('GET', `/api/books?missing=stories_anthology&q=${stem}&limit=200`);
      const ids = new Set(list.books.map(x => x.id));
      assert.ok(ids.has(both.id), 'book tagged with both should appear');
      assert.ok(!ids.has(storiesOnly.id), 'Stories-only must NOT appear');
      assert.ok(!ids.has(anthOnly.id),    'Anthology-only must NOT appear');
      assert.ok(!ids.has(untagged.id),    'untagged must NOT appear');
    });

    it('missing=series / series_number filter two-sided series metadata gaps', async () => {
      const stem = 'seriesfilter' + Math.random().toString(36).slice(2, 6);
      const author = `ZZZ-Series ${stem}`;
      // Series field set, series_number null — should appear in missing=series_number.
      const { body: a } = await req('POST', '/api/books', {
        title: `${stem}-series no num`, series: `${stem} Saga`, authors: [author],
      });
      // series_number set, series null — should appear in missing=series.
      const { body: b } = await req('POST', '/api/books', {
        title: `${stem}-num no series`, series_number: 3, authors: [author],
      });
      // Both set — should NOT appear in either.
      const { body: c } = await req('POST', '/api/books', {
        title: `${stem}-both set`, series: `${stem} Saga`, series_number: 1, authors: [author],
      });
      // Neither set — should NOT appear in either.
      const { body: d } = await req('POST', '/api/books', {
        title: `${stem}-neither`, authors: [author],
      });

      const { body: noNum } = await req('GET', `/api/books?missing=series_number&q=${stem}&limit=200`);
      const noNumIds = new Set(noNum.books.map(x => x.id));
      assert.ok(noNumIds.has(a.id), 'series-without-number should appear in missing=series_number');
      assert.ok(!noNumIds.has(b.id), 'number-without-series must NOT appear in missing=series_number');
      assert.ok(!noNumIds.has(c.id), 'both-set must NOT appear');
      assert.ok(!noNumIds.has(d.id), 'neither-set must NOT appear');

      const { body: noSer } = await req('GET', `/api/books?missing=series&q=${stem}&limit=200`);
      const noSerIds = new Set(noSer.books.map(x => x.id));
      assert.ok(noSerIds.has(b.id), 'number-without-series should appear in missing=series');
      assert.ok(!noSerIds.has(a.id), 'series-without-number must NOT appear in missing=series');
      assert.ok(!noSerIds.has(c.id), 'both-set must NOT appear');
      assert.ok(!noSerIds.has(d.id), 'neither-set must NOT appear');
    });

    it('cascade-deletes stories when the parent book is deleted', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Parent To Delete' });
      const { body: created } = await req('POST', `/api/books/${b.id}/stories`, { title: 'Orphan-To-Be' });
      await req('DELETE', `/api/books/${b.id}`);
      // Re-creating the same book id is unlikely; the orphan check is via
      // the stories table directly. We verify via raw DB shape: the parent
      // is gone, so a fetch on its old id yields []; this is sufficient
      // because the cascade is enforced by the FOREIGN KEY ... ON DELETE
      // CASCADE in 049_add_stories.sql.
      const { status } = await req('GET', `/api/books/${b.id}`);
      assert.equal(status, 404);
      // The story id should also no longer round-trip — re-issuing PUT on
      // it would 404. Use any book id to scope the path; the route checks
      // story existence within the book scope.
      const reput = await req('PUT', `/api/books/${b.id}/stories/${created.id}`, { title: 'x' });
      assert.equal(reput.status, 404);
    });

    // Layer 3 pass 1: a story-finish writes a reading_log row attributed
    // to the story (surfaced in the diary as "Read 'Story' — Book") and
    // bumps the parent book's current_page to page_end so progress
    // indicators stay coherent for cherry-picked story reads.
    describe('Layer 3 reading_log attribution', () => {
      function diaryEntries(diary, predicate) {
        return diary.days.flatMap(d => d.entries).filter(predicate);
      }

      it('finishing a story with a page range writes an attributed reading_log row', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3 Page Range Coll' });
        const { body: s } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Hour of the Dragon', position: 1,
          status: 'finished', date_finished: '2025-04-15',
          page_start: 234, page_end: 333,
        });
        const { body: diary } = await req('GET', '/api/diary?year=2025');
        const matches = diaryEntries(diary, e => e.story_id === s.id);
        assert.equal(matches.length, 1, 'one diary entry attributed to the story');
        assert.equal(matches[0].story_title, 'Hour of the Dragon');
        assert.equal(matches[0].story_position, 1);
        assert.equal(matches[0].pages_read, 100);  // 333 - 234 + 1
        assert.equal(matches[0].book_id, b.id);
        assert.equal(matches[0].title, 'L3 Page Range Coll');
      });

      it('finishing a story without a page range writes a zero-page attributed row', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3 Audio Coll', format: 'audiobook' });
        const { body: s } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Track 7', position: 7,
          status: 'finished', date_finished: '2025-04-16',
        });
        const { body: diary } = await req('GET', '/api/diary?year=2025');
        const matches = diaryEntries(diary, e => e.story_id === s.id);
        assert.equal(matches.length, 1);
        assert.equal(matches[0].pages_read, 0);
        assert.equal(matches[0].story_title, 'Track 7');
      });

      it('finishing a story bumps parent current_page to page_end', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3 Progress Bump', page_count: 500 });
        // current_page is PATCH-only; seed via PATCH after create.
        await req('PATCH', `/api/books/${b.id}`, { current_page: 50 });
        // A second unread sibling keeps the parent unfinished so the
        // current_page bump from logStoryFinish stays visible (without
        // it the pass-2 auto-roll would set current_page = page_count).
        await req('POST', `/api/books/${b.id}/stories`, { title: 'Other', status: 'unread' });
        await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Late Story', status: 'finished', date_finished: '2025-04-17',
          page_start: 200, page_end: 280,
        });
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.equal(full.current_page, 280);
      });

      it('finishing a story does not lower current_page if already past page_end', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3 No Regress', page_count: 500 });
        await req('PATCH', `/api/books/${b.id}`, { current_page: 400 });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'Other', status: 'unread' });
        await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Earlier Story', status: 'finished', date_finished: '2025-04-18',
          page_start: 50, page_end: 100,
        });
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.equal(full.current_page, 400);
      });

      it('PUT to finished writes a log row; resaving an already-finished story does not duplicate', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3 PUT Transition' });
        const { body: s } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Transitioner', status: 'unread',
          page_start: 1, page_end: 10,
        });
        await req('PUT', `/api/books/${b.id}/stories/${s.id}`, {
          title: 'Transitioner', status: 'finished', date_finished: '2025-04-19',
          page_start: 1, page_end: 10,
        });
        await req('PUT', `/api/books/${b.id}/stories/${s.id}`, {
          title: 'Transitioner v2', status: 'finished', date_finished: '2025-04-19',
          page_start: 1, page_end: 10, rating: 4,
        });
        const { body: diary } = await req('GET', '/api/diary?year=2025');
        const matches = diaryEntries(diary, e => e.story_id === s.id);
        assert.equal(matches.length, 1, 'second PUT must not write a duplicate row');
      });

      it('deleting a story keeps the reading_log row but nulls story_id', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3 Story Delete' });
        const { body: s } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Will Be Orphaned', status: 'finished', date_finished: '2025-04-20',
          page_start: 1, page_end: 50,
        });
        await req('DELETE', `/api/books/${b.id}/stories/${s.id}`);
        const { body: diary } = await req('GET', '/api/diary?year=2025');
        // The row survives the story delete (ON DELETE SET NULL) but no
        // longer carries a story_title — it appears as a book-level row.
        const orphaned = diaryEntries(diary, e =>
          e.book_id === b.id && e.pages_read === 50 && e.story_id == null
        );
        assert.equal(orphaned.length, 1);
        assert.equal(orphaned[0].story_title, null);
      });

      it('book-level pages_read upsert still merges same-day deltas', async () => {
        // Verifies the partial-index upsert continues to work on the
        // (book_id, date) WHERE story_id IS NULL path.
        const { body: b } = await req('POST', '/api/books', { title: 'L3 Book Upsert', page_count: 500 });
        await req('PATCH', `/api/books/${b.id}`, { current_page: 30 });
        await req('PATCH', `/api/books/${b.id}`, { current_page: 80 });
        const { body: diary } = await req('GET', '/api/diary');
        const matches = diaryEntries(diary, e =>
          e.book_id === b.id && e.story_id == null
        );
        assert.equal(matches.length, 1, 'two same-day patches collapse to one row');
        assert.equal(matches[0].pages_read, 80);
      });

      it('book-level and story-level rows can coexist for the same day on the same book', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3 Coexist', page_count: 500 });
        await req('PATCH', `/api/books/${b.id}`, { current_page: 25 });
        const todayIso = new Date().toLocaleDateString('en-CA');
        const { body: s } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Same-Day Story', status: 'finished', date_finished: todayIso,
          page_start: 100, page_end: 110,
        });
        const { body: diary } = await req('GET', '/api/diary');
        const bookRows = diaryEntries(diary, e => e.book_id === b.id && e.story_id == null);
        const storyRows = diaryEntries(diary, e => e.story_id === s.id);
        assert.equal(bookRows.length, 1);
        assert.equal(storyRows.length, 1);
      });
    });

    // Layer 3 pass 2: parent auto-roll. When every story in a collection
    // is accounted for (status='finished' OR did_not_finish=1), the parent
    // book auto-transitions to 'finished' — bumping read_count, inserting
    // a reads row, setting date_finished, and surfacing parent_auto_finished
    // in the response so the client can fire the rating prompt.
    describe('Layer 3 pass 2 parent auto-roll', () => {
      const todayIso = () => new Date().toLocaleDateString('en-CA');

      it('finishing the last story auto-rolls the parent to finished', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3p2 Roll Up', page_count: 200 });
        const { body: a }  = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: bb } = await req('POST', `/api/books/${b.id}/stories`, { title: 'B' });
        const { body: mid } = await req('PUT', `/api/books/${b.id}/stories/${a.id}`, {
          title: 'A', status: 'finished', date_finished: todayIso(),
        });
        assert.equal(mid.parent_auto_finished, false, 'first of two finishes does not roll');
        const { body: last } = await req('PUT', `/api/books/${b.id}/stories/${bb.id}`, {
          title: 'B', status: 'finished', date_finished: todayIso(),
        });
        assert.equal(last.parent_auto_finished, true);
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.equal(full.status, 'finished');
        assert.equal(full.read_count, 1);
        assert.equal(full.current_page, 200);
        assert.equal(full.date_finished, todayIso());
        const { body: reads } = await req('GET', `/api/books/${b.id}/reads`);
        assert.equal(reads.length, 1);
      });

      it('the last DNF transition also rolls the parent', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3p2 DNF Closes' });
        const { body: a } = await req('POST', `/api/books/${b.id}/stories`, { title: 'Read it' });
        const { body: c } = await req('POST', `/api/books/${b.id}/stories`, { title: 'Skipped' });
        await req('PUT', `/api/books/${b.id}/stories/${a.id}`, { title: 'Read it', status: 'finished', date_finished: todayIso() });
        const { body: last } = await req('PUT', `/api/books/${b.id}/stories/${c.id}`, {
          title: 'Skipped', did_not_finish: true,
        });
        assert.equal(last.parent_auto_finished, true);
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.equal(full.status, 'finished');
      });

      it('mixed state does not roll', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3p2 Mixed' });
        const { body: a } = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: bb } = await req('POST', `/api/books/${b.id}/stories`, { title: 'B' });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'C' });
        await req('PUT', `/api/books/${b.id}/stories/${a.id}`, { title: 'A', status: 'finished', date_finished: todayIso() });
        const { body: last } = await req('PUT', `/api/books/${b.id}/stories/${bb.id}`, {
          title: 'B', did_not_finish: true,
        });
        assert.equal(last.parent_auto_finished, false);
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.notEqual(full.status, 'finished');
      });

      it('already-finished parent does not double-roll', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3p2 Already Done' });
        // Manually finish the parent first (read_count goes to 1).
        await req('PUT', `/api/books/${b.id}`, { title: 'L3p2 Already Done', status: 'finished' });
        const { body: a } = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: ax } = await req('PUT', `/api/books/${b.id}/stories/${a.id}`, {
          title: 'A', status: 'finished', date_finished: todayIso(),
        });
        assert.equal(ax.parent_auto_finished, false, 'no roll on an already-finished parent');
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.equal(full.read_count, 1);
      });

      it('books without any stories are unaffected', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3p2 No Stories' });
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.notEqual(full.status, 'finished');
      });

      it('re-read flow: revert parent, finish last story again, read_count bumps to 2', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'L3p2 Re-Read' });
        const { body: s1 } = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: s2 } = await req('POST', `/api/books/${b.id}/stories`, { title: 'B' });
        await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, { title: 'A', status: 'finished', date_finished: todayIso() });
        await req('PUT', `/api/books/${b.id}/stories/${s2.id}`, { title: 'B', status: 'finished', date_finished: todayIso() });
        let full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.status, 'finished');
        assert.equal(full.read_count, 1);
        // User reverts parent for a re-read, then re-marks one story as
        // unread, then re-finishes it. The auto-roll fires again on the
        // last finish. read_count climbs to 2.
        await req('PUT', `/api/books/${b.id}`, { title: 'L3p2 Re-Read', status: 'unread' });
        await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, { title: 'A', status: 'unread' });
        await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, { title: 'A', status: 'finished', date_finished: todayIso() });
        full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.status, 'finished');
        assert.equal(full.read_count, 2);
      });

      it('auto-roll bumps current_minutes to duration_minutes for audiobooks', async () => {
        const { body: b } = await req('POST', '/api/books', {
          title: 'L3p2 Audio Roll', format: 'audiobook', duration_minutes: 600,
        });
        const { body: a } = await req('POST', `/api/books/${b.id}/stories`, { title: 'Track 1' });
        await req('PUT', `/api/books/${b.id}/stories/${a.id}`, {
          title: 'Track 1', status: 'finished', date_finished: todayIso(),
        });
        const { body: full } = await req('GET', `/api/books/${b.id}`);
        assert.equal(full.status, 'finished');
        assert.equal(full.current_minutes, 600);
      });
    });

    // Layer 3 pass 3: per-book current_story preview on listBooks. A
    // collection with a 'reading' story surfaces it on the Library
    // Reading tab as a subline under the progress label, so the user
    // knows which story they're in without opening the book.
    describe('Layer 3 pass 3 listBooks current_story', () => {
      it('current_story surfaces the active reading story', async () => {
        const stem = 'l3p3a' + Math.random().toString(36).slice(2, 6);
        const { body: b } = await req('POST', '/api/books', { title: `${stem}-coll` });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'A', position: 1, status: 'unread' });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'B', position: 2, status: 'reading' });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'C', position: 3, status: 'unread' });
        const { body: list } = await req('GET', `/api/books?q=${stem}`);
        const found = list.books.find(x => x.id === b.id);
        assert.ok(found, 'parent book listed');
        assert.ok(found.current_story);
        assert.equal(found.current_story.title, 'B');
        assert.equal(found.current_story.position, 2);
      });

      it('current_story is null when no story is reading', async () => {
        const stem = 'l3p3b' + Math.random().toString(36).slice(2, 6);
        const { body: b } = await req('POST', '/api/books', { title: `${stem}-coll` });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'A', position: 1, status: 'unread' });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'B', position: 2, status: 'finished' });
        const { body: list } = await req('GET', `/api/books?q=${stem}`);
        const found = list.books.find(x => x.id === b.id);
        assert.equal(found.current_story, null);
      });

      it('first-by-position wins when multiple stories are reading', async () => {
        const stem = 'l3p3c' + Math.random().toString(36).slice(2, 6);
        const { body: b } = await req('POST', '/api/books', { title: `${stem}-coll` });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'Later',  position: 5, status: 'reading' });
        await req('POST', `/api/books/${b.id}/stories`, { title: 'Sooner', position: 2, status: 'reading' });
        const { body: list } = await req('GET', `/api/books?q=${stem}`);
        const found = list.books.find(x => x.id === b.id);
        assert.equal(found.current_story.title, 'Sooner');
      });

      it('books without stories return current_story: null', async () => {
        const stem = 'l3p3d' + Math.random().toString(36).slice(2, 6);
        const { body: b } = await req('POST', '/api/books', { title: `${stem}-plain` });
        const { body: list } = await req('GET', `/api/books?q=${stem}`);
        const found = list.books.find(x => x.id === b.id);
        assert.equal(found.current_story, null);
      });
    });

    // Layer 4 pass 1: per-story year_published. Foundation for the cross-
    // collection chronological view that ships in pass 2; this pass only
    // verifies the field round-trips and validates correctly.
    describe('Layer 4 pass 1 year_published', () => {
      let bookId;
      before(async () => {
        const { body } = await req('POST', '/api/books', { title: 'L4 Year Coll' });
        bookId = body.id;
      });

      it('persists year_published on POST and surfaces it on GET', async () => {
        const { body: created } = await req('POST', `/api/books/${bookId}/stories`, {
          title: 'The Island of Doctor Death and Other Stories', year_published: 1970,
        });
        assert.equal(created.year_published, 1970);
        const { body: full } = await req('GET', `/api/books/${bookId}`);
        const fetched = full.stories.find(s => s.id === created.id);
        assert.equal(fetched.year_published, 1970);
      });

      it('PUT updates year_published and accepts null to clear', async () => {
        const { body: created } = await req('POST', `/api/books/${bookId}/stories`, {
          title: 'Trip, Trap', year_published: 1967,
        });
        const { body: updated } = await req('PUT', `/api/books/${bookId}/stories/${created.id}`, {
          title: 'Trip, Trap', year_published: 1968,
        });
        assert.equal(updated.year_published, 1968);
        const { body: cleared } = await req('PUT', `/api/books/${bookId}/stories/${created.id}`, {
          title: 'Trip, Trap', year_published: null,
        });
        assert.equal(cleared.year_published, null);
      });

      it('null / omitted year_published is permitted', async () => {
        const { body: a } = await req('POST', `/api/books/${bookId}/stories`, { title: 'No year A' });
        assert.equal(a.year_published, null);
        const { body: b } = await req('POST', `/api/books/${bookId}/stories`, { title: 'No year B', year_published: null });
        assert.equal(b.year_published, null);
      });

      it('rejects non-integer and zero years', async () => {
        const r1 = await req('POST', `/api/books/${bookId}/stories`, { title: 'Bad year', year_published: 'abc' });
        assert.equal(r1.status, 400);
        const r2 = await req('POST', `/api/books/${bookId}/stories`, { title: 'Zero year', year_published: 0 });
        assert.equal(r2.status, 400);
        const r3 = await req('POST', `/api/books/${bookId}/stories`, { title: 'Float year', year_published: 1934.5 });
        assert.equal(r3.status, 400);
      });

      it('accepts negative years for ancient works', async () => {
        const { body, status } = await req('POST', `/api/books/${bookId}/stories`, {
          title: 'On the Heavens', year_published: -350,
        });
        assert.equal(status, 201);
        assert.equal(body.year_published, -350);
      });
    });

    // Regression: bug-sweep on the new collection / story features.
    //   A. Partial date_finished must not leak into reading_log.date,
    //      where it would break the diary year filter (LIKE 'YYYY-%').
    //   B. The parent auto-roll must not fire on writes that don't move
    //      the story from unaccounted to accounted — otherwise saving a
    //      note on an already-finished story after a manual parent
    //      revert silently re-rolls and bumps read_count.
    describe('Stories bug-sweep regressions', () => {
      const todayIso = () => new Date().toLocaleDateString('en-CA');

      it('partial date_finished falls back to today in reading_log', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'Bug A Year-Only' });
        const { body: s } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Long-ago read', status: 'finished', date_finished: '1998',
        });
        const { body: diary } = await req('GET', '/api/diary');
        const matches = diary.days.flatMap(d => d.entries).filter(e => e.story_id === s.id);
        assert.equal(matches.length, 1, 'attribution survives the partial date');
        // The reading_log row should be on today, not '1998'. Verify by
        // checking that the diary entry sits under today's day.
        const todaysEntries = diary.days.find(d => d.date === todayIso())?.entries || [];
        assert.ok(todaysEntries.some(e => e.story_id === s.id),
          'partial-date story finish lands under today');
      });

      it('full ISO date_finished still routes to its actual date', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'Bug A Full ISO' });
        const { body: s } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Backdated finish', status: 'finished', date_finished: '2024-08-15',
        });
        const { body: diary } = await req('GET', '/api/diary?year=2024');
        const matches = diary.days.flatMap(d => d.entries).filter(e => e.story_id === s.id);
        assert.equal(matches.length, 1, 'full ISO date routes to its day');
        const day = diary.days.find(d => d.entries.some(e => e.story_id === s.id));
        assert.equal(day.date, '2024-08-15');
      });

      it('saving a finished story does not re-roll a manually-reverted parent', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'Bug B No Re-Roll' });
        const { body: s1 } = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: s2 } = await req('POST', `/api/books/${b.id}/stories`, { title: 'B' });
        await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, { title: 'A', status: 'finished', date_finished: todayIso() });
        await req('PUT', `/api/books/${b.id}/stories/${s2.id}`, { title: 'B', status: 'finished', date_finished: todayIso() });
        // First auto-roll: parent finished, read_count = 1.
        let full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.read_count, 1);
        // User reverts parent to start a re-read. They have NOT yet
        // unmarked any story — both still 'finished'.
        await req('PUT', `/api/books/${b.id}`, { title: 'Bug B No Re-Roll', status: 'unread' });
        // User edits a note on one of the already-finished stories. No
        // accounting transition happened in this PUT — the parent must
        // stay where the user put it.
        const { body: noteEdit } = await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, {
          title: 'A', status: 'finished', date_finished: todayIso(), notes: 'Loved this one',
        });
        assert.equal(noteEdit.parent_auto_finished, false, 'no roll on a non-transition write');
        full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.status, 'unread', 'parent stays where the user put it');
        assert.equal(full.read_count, 1, 'read_count not bumped a second time');
      });

      it('deleting the last unaccounted story rolls the parent', async () => {
        // Bug D: a data-correction delete (e.g. an erroneously-added
        // story removed) can be the act that completes a collection.
        // Symmetric to the POST/PUT auto-roll path.
        const { body: b } = await req('POST', '/api/books', { title: 'Bug D Delete Rolls' });
        const { body: a }  = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: bb } = await req('POST', `/api/books/${b.id}/stories`, { title: 'B' });
        const { body: c }  = await req('POST', `/api/books/${b.id}/stories`, { title: 'C-erroneous' });
        await req('PUT', `/api/books/${b.id}/stories/${a.id}`,  { title: 'A', status: 'finished', date_finished: todayIso() });
        await req('PUT', `/api/books/${b.id}/stories/${bb.id}`, { title: 'B', status: 'finished', date_finished: todayIso() });
        // C is still unread — parent must not have rolled yet.
        let full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.notEqual(full.status, 'finished');
        // Delete C — A and B remain, both finished. Parent rolls.
        const { status } = await req('DELETE', `/api/books/${b.id}/stories/${c.id}`);
        assert.equal(status, 204);
        full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.status, 'finished');
        assert.equal(full.read_count, 1);
      });

      it('deleting all stories from a collection does NOT roll', async () => {
        // Empty-stories matches the books-without-stories rule: no
        // auto-roll candidate, parent stays where it was.
        const { body: b } = await req('POST', '/api/books', { title: 'Bug D Empty Stays' });
        const { body: only } = await req('POST', `/api/books/${b.id}/stories`, { title: 'Only one' });
        await req('DELETE', `/api/books/${b.id}/stories/${only.id}`);
        const full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.notEqual(full.status, 'finished');
        assert.equal(full.read_count, 0);
      });

      it('deleting from an already-finished parent does not double-roll', async () => {
        const { body: b } = await req('POST', '/api/books', { title: 'Bug D No Double' });
        const { body: a } = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: bb } = await req('POST', `/api/books/${b.id}/stories`, { title: 'B' });
        await req('PUT', `/api/books/${b.id}/stories/${a.id}`,  { title: 'A', status: 'finished', date_finished: todayIso() });
        await req('PUT', `/api/books/${b.id}/stories/${bb.id}`, { title: 'B', status: 'finished', date_finished: todayIso() });
        // Parent already finished; read_count = 1.
        let full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.read_count, 1);
        // Delete B — remaining A is still finished, but parent is already
        // 'finished'. The function's own guard prevents a second roll.
        await req('DELETE', `/api/books/${b.id}/stories/${bb.id}`);
        full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.read_count, 1, 'no second read_count bump');
      });

      it('empty-string position and rating coerce to null, not 0', async () => {
        // Defensive: a cleared form input sends '' rather than null. Without
        // the isBlank guard, '' coerces to 0 — silently polluting the
        // contents-list ordering for position, and tripping the rating
        // validator with a misleading "0.5–5" error for rating.
        const { body: b } = await req('POST', '/api/books', { title: 'Bug E Empty Strings' });
        const { body: s, status } = await req('POST', `/api/books/${b.id}/stories`, {
          title: 'Cleared inputs', position: '', rating: '', page_start: '', page_end: '', year_published: '',
        });
        assert.equal(status, 201);
        assert.equal(s.position, null);
        assert.equal(s.rating, null);
        assert.equal(s.page_start, null);
        assert.equal(s.page_end, null);
        assert.equal(s.year_published, null);
      });

      it('genuine accounting transition still rolls the parent', async () => {
        // Sanity: the gate must not block legitimate transitions. After
        // reverting the parent and unmarking a story as 'unread', re-
        // finishing it is a real accounting transition and the parent
        // must auto-roll back to 'finished' with read_count = 2.
        const { body: b } = await req('POST', '/api/books', { title: 'Bug B Gate Sanity' });
        const { body: s1 } = await req('POST', `/api/books/${b.id}/stories`, { title: 'A' });
        const { body: s2 } = await req('POST', `/api/books/${b.id}/stories`, { title: 'B' });
        await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, { title: 'A', status: 'finished', date_finished: todayIso() });
        await req('PUT', `/api/books/${b.id}/stories/${s2.id}`, { title: 'B', status: 'finished', date_finished: todayIso() });
        await req('PUT', `/api/books/${b.id}`, { title: 'Bug B Gate Sanity', status: 'unread' });
        await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, { title: 'A', status: 'unread' });
        const { body: rolled } = await req('PUT', `/api/books/${b.id}/stories/${s1.id}`, {
          title: 'A', status: 'finished', date_finished: todayIso(),
        });
        assert.equal(rolled.parent_auto_finished, true);
        const full = (await req('GET', `/api/books/${b.id}`)).body;
        assert.equal(full.read_count, 2);
      });
    });
  });

  describe('missing= filters exclude custom books', () => {
    // Custom (user-assembled) books don't have publishers, acquisition
    // sources, or acquisition dates as a matter of model. Surfacing them
    // in maintenance "missing X" filters is noise. Mirrors the existing
    // is_custom guard on missing=isbn.

    it('missing=publisher does not surface custom books', async () => {
      const stem = 'misspub' + Math.random().toString(36).slice(2, 6);
      // Custom + no publisher: must NOT appear.
      const { body: c } = await req('POST', '/api/books', { title: `${stem}-custom`, is_custom: true });
      // Real book + no publisher: SHOULD appear.
      const { body: r } = await req('POST', '/api/books', { title: `${stem}-real-empty` });
      // Real book + publisher set: must NOT appear.
      const { body: p } = await req('POST', '/api/books', { title: `${stem}-real-pub`, publisher: 'Some Press' });

      const { body: list } = await req('GET', `/api/books?missing=publisher&q=${stem}&limit=200`);
      const ids = new Set(list.books.map(b => b.id));
      assert.ok(!ids.has(c.id), 'custom book must not appear');
      assert.ok(ids.has(r.id), 'real book without publisher should appear');
      assert.ok(!ids.has(p.id), 'real book with publisher must not appear');
    });

    it('missing=source does not surface custom books', async () => {
      const stem = 'misssrc' + Math.random().toString(36).slice(2, 6);
      // Custom is always owned and acquisition_source is always nulled —
      // would silently match without the is_custom guard.
      const { body: c } = await req('POST', '/api/books', { title: `${stem}-custom`, is_custom: true });
      // Owned + no acquisition_source: SHOULD appear.
      const { body: r } = await req('POST', '/api/books', { title: `${stem}-real-owned`, owned: true });
      // Owned + acquisition_source set: must NOT appear.
      const { body: p } = await req('POST', '/api/books', {
        title: `${stem}-real-sourced`, owned: true, acquisition_source: 'Kindle',
      });

      const { body: list } = await req('GET', `/api/books?missing=source&q=${stem}&limit=200`);
      const ids = new Set(list.books.map(b => b.id));
      assert.ok(!ids.has(c.id), 'custom book must not appear');
      assert.ok(ids.has(r.id), 'owned book without source should appear');
      assert.ok(!ids.has(p.id), 'owned book with source must not appear');
    });

    it('missing=acquired does not surface custom books', async () => {
      const stem = 'missacq' + Math.random().toString(36).slice(2, 6);
      const { body: c } = await req('POST', '/api/books', { title: `${stem}-custom`, is_custom: true });
      const { body: r } = await req('POST', '/api/books', { title: `${stem}-real-owned`, owned: true });
      const { body: p } = await req('POST', '/api/books', {
        title: `${stem}-real-acquired`, owned: true, acquisition_date: '2024-05-01',
      });

      const { body: list } = await req('GET', `/api/books?missing=acquired&q=${stem}&limit=200`);
      const ids = new Set(list.books.map(b => b.id));
      assert.ok(!ids.has(c.id), 'custom book must not appear');
      assert.ok(ids.has(r.id), 'owned book without acquisition_date should appear');
      assert.ok(!ids.has(p.id), 'owned book with acquisition_date must not appear');
    });
  });

  describe('field persistence', () => {
    it('saves and returns authors', async () => {
      const { status, body } = await req('POST', '/api/books', {
        title: 'Dune', authors: ['Frank Herbert'],
      });
      assert.equal(status, 201);
      assert.equal(body.authors.length, 1);
      assert.equal(body.authors[0].name, 'Frank Herbert');
    });

    it('saves and returns narrators', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dune Audio', narrators: ['Scott Brick'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'Scott Brick');
    });

    it('saves description, notes, review, series, series_number', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Fellowship',
        description: 'A hobbit leaves home.',
        notes: 'First edition.',
        review: 'Loved it.',
        series: 'The Lord of the Rings',
        series_number: 1,
      });
      assert.equal(body.description, 'A hobbit leaves home.');
      assert.equal(body.notes, 'First edition.');
      assert.equal(body.review, 'Loved it.');
      assert.equal(body.series, 'The Lord of the Rings');
      assert.equal(body.series_number, 1);
    });

    it('saves translators and original_language', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Crime and Punishment',
        translators: ['Richard Pevear', 'Larissa Volokhonsky'],
        original_language: 'Russian',
        language: 'English',
      });
      assert.deepEqual(body.translators.map(t => t.name), ['Richard Pevear', 'Larissa Volokhonsky']);
      assert.equal(body.original_language, 'Russian');
    });

    it('q search matches names across all people roles', async () => {
      const cases = [
        { role: 'author',     key: 'authors',     surname: 'Quincombe',  match: 'Inigo Quincombe',    other: 'Hendrik Vossberg' },
        { role: 'narrator',   key: 'narrators',   surname: 'Trellisway', match: 'Mira Trellisway',    other: 'Lukas Brimsden' },
        { role: 'translator', key: 'translators', surname: 'Garnett',    match: 'Constance Garnett',  other: 'Padma Calderwood' },
      ];

      for (const c of cases) {
        const { body: matched } = await req('POST', '/api/books', {
          title: `q search ${c.role} matched`, [c.key]: [c.match],
        });
        const { body: other } = await req('POST', '/api/books', {
          title: `q search ${c.role} other`, [c.key]: [c.other],
        });
        const { body: results } = await req('GET', `/api/books?q=${c.surname}`);
        const ids = results.books.map(b => b.id);
        assert.ok(ids.includes(matched.id),
          `expected q=${c.surname} to match book with ${c.role} '${c.match}'`);
        assert.ok(!ids.includes(other.id),
          `expected q=${c.surname} to exclude book whose only ${c.role} is '${c.other}'`);
      }
    });

    it('statuses[] filter accepts multiple statuses (OR within the filter, AND with everything else)', async () => {
      // The Library tab strip pins one status at a time (or owned/all);
      // statuses[] is the multi-select that lives in FilterPanel for use on
      // the owned/prev_owned/loved/all tabs where status is orthogonal.
      const stem = 'statuses-' + Math.random().toString(36).slice(2, 7);
      const { body: rd } = await req('POST', '/api/books', { title: `${stem} reading`,  status: 'reading' });
      const { body: fd } = await req('POST', '/api/books', { title: `${stem} finished`, status: 'finished' });
      const { body: ud } = await req('POST', '/api/books', { title: `${stem} unread`,   status: 'unread' });

      const enc = encodeURIComponent;
      const collect = async (q) => {
        const { body } = await req('GET', `/api/books?q=${enc(stem)}&${q}&limit=50`);
        return new Set(body.books.map(b => b.id));
      };

      // Single status: just that status.
      const oneOnly = await collect('statuses=reading');
      assert.ok(oneOnly.has(rd.id));
      assert.ok(!oneOnly.has(fd.id));
      assert.ok(!oneOnly.has(ud.id));

      // Multi: queue shortcut (reading OR unread — books to start or continue).
      const queue = await collect('statuses=reading&statuses=unread');
      assert.ok(queue.has(rd.id));
      assert.ok(queue.has(ud.id));
      assert.ok(!queue.has(fd.id));

      // No statuses param → no status restriction (all three match the stem).
      const all = await collect('');
      assert.ok(all.has(rd.id) && all.has(fd.id) && all.has(ud.id));
    });

    it('tag filter defaults to AND across multiple tags; tagsMode=any opts back into OR', async () => {
      // Mirrors the search-bar AND default. The legacy 'any' (IN-list) path
      // is kept for users who want the multi-select facet behavior.
      const stem = 'tagmode-' + Math.random().toString(36).slice(2, 7);
      // Disambiguating tag tokens — share a stem so the test can scope to its
      // own fixtures even on a populated library.
      const tagA = `${stem}-A`;
      const tagB = `${stem}-B`;
      const { body: both } = await req('POST', '/api/books', {
        title: `${stem} both`, tags: [tagA, tagB],
      });
      const { body: aOnly } = await req('POST', '/api/books', {
        title: `${stem} aOnly`, tags: [tagA],
      });
      const { body: bOnly } = await req('POST', '/api/books', {
        title: `${stem} bOnly`, tags: [tagB],
      });

      const enc = encodeURIComponent;
      const collect = async (q) => {
        const { body } = await req('GET', `/api/books?${q}&limit=50`);
        return new Set(body.books.map(b => b.id));
      };

      // Default (AND): only the book with both tags.
      const andResult = await collect(`tags=${enc(tagA)}&tags=${enc(tagB)}`);
      assert.ok(andResult.has(both.id), 'AND should match the two-tag book');
      assert.ok(!andResult.has(aOnly.id), 'AND should exclude single-tag book A');
      assert.ok(!andResult.has(bOnly.id), 'AND should exclude single-tag book B');

      // Explicit any: every selected tag's books.
      const orResult = await collect(`tags=${enc(tagA)}&tags=${enc(tagB)}&tagsMode=any`);
      assert.ok(orResult.has(both.id));
      assert.ok(orResult.has(aOnly.id));
      assert.ok(orResult.has(bOnly.id));

      // Single-tag selection is unchanged (the AND/HAVING branch only fires for ≥2).
      const singleResult = await collect(`tags=${enc(tagA)}`);
      assert.ok(singleResult.has(both.id));
      assert.ok(singleResult.has(aOnly.id));
      assert.ok(!singleResult.has(bOnly.id));
    });

    it('q supports Google-style AND / OR / NOT / phrases / parens', async () => {
      // Build a small fixture with three orthogonal tag groupings so each
      // operator can be exercised on its own. Stems keep names unique across
      // test re-runs.
      const stem = 'dsl-' + Math.random().toString(36).slice(2, 7);
      const { body: scifiManga } = await req('POST', '/api/books', {
        title: `${stem} alpha`, tags: ['Sci-Fi', 'Manga'],
      });
      const { body: scifiOnly } = await req('POST', '/api/books', {
        title: `${stem} beta`, tags: ['Sci-Fi'],
      });
      const { body: mangaOnly } = await req('POST', '/api/books', {
        title: `${stem} gamma`, tags: ['Manga'],
      });
      const { body: neither } = await req('POST', '/api/books', {
        title: `${stem} delta`, tags: ['History'],
      });

      const collect = async (q) => {
        const { body } = await req('GET', `/api/books?q=${encodeURIComponent(q)}&limit=50`);
        return new Set(body.books.map(b => b.id));
      };

      // Implicit AND: both tags required → only the (Sci-Fi, Manga) book.
      // Use a tag-name that won't surface from the title (titles use stems).
      const andResult = await collect(`${stem} Sci-Fi Manga`);
      assert.ok(andResult.has(scifiManga.id), 'AND should match book with both tags');
      assert.ok(!andResult.has(scifiOnly.id), 'AND should exclude Sci-Fi-only');
      assert.ok(!andResult.has(mangaOnly.id), 'AND should exclude Manga-only');

      // Explicit OR: either tag matches.
      const orResult = await collect(`${stem} (Sci-Fi OR Manga)`);
      assert.ok(orResult.has(scifiManga.id));
      assert.ok(orResult.has(scifiOnly.id));
      assert.ok(orResult.has(mangaOnly.id));
      assert.ok(!orResult.has(neither.id));

      // NOT: exclude books with a given tag.
      const notResult = await collect(`${stem} -Manga`);
      assert.ok(notResult.has(scifiOnly.id), 'NOT should keep Sci-Fi-only');
      assert.ok(notResult.has(neither.id),   'NOT should keep History-only');
      assert.ok(!notResult.has(scifiManga.id), 'NOT should drop Manga-tagged');
      assert.ok(!notResult.has(mangaOnly.id),  'NOT should drop Manga-tagged');

      // Quoted phrase: literal substring, distinct from token AND.
      const { body: phraseBook } = await req('POST', '/api/books', {
        title: `${stem} heart of darkness fixture`,
      });
      const phraseResult = await collect(`"heart of darkness" ${stem}`);
      assert.ok(phraseResult.has(phraseBook.id), 'phrase should match exact substring');

      // Lowercase 'or' is a literal term, not the OR operator (so titles like
      // "Pride or Prejudice" don't get parsed as boolean expressions).
      const { body: orBook } = await req('POST', '/api/books', {
        title: `${stem} pride or prejudice`,
      });
      const lowerResult = await collect(`${stem} pride or prejudice`);
      assert.ok(lowerResult.has(orBook.id), 'lowercase or should be treated as a term');

      // NOT keyword (uppercase) is equivalent to '-' prefix.
      const notKeywordResult = await collect(`${stem} NOT Manga`);
      assert.ok(notKeywordResult.has(scifiOnly.id));
      assert.ok(!notKeywordResult.has(scifiManga.id));

      // Regression: unmatched ')' used to terminate the AND-loop early and
      // silently drop every following token. Now stripped pre-parse so the
      // intent ("stem AND Sci-Fi") survives.
      const unbalanced = await collect(`${stem})) Sci-Fi`);
      assert.ok(unbalanced.has(scifiManga.id), 'unmatched paren should not eat trailing tokens');
      assert.ok(unbalanced.has(scifiOnly.id));
      assert.ok(!unbalanced.has(mangaOnly.id), 'should still require Sci-Fi');
    });

    it('field=rating filters by exact rating value (incl. half-stars)', async () => {
      // Branch: rating = parseFloat(v). Use a half-star to confirm parseFloat
      // is preserved end-to-end and the SQL = comparison handles 4.5.
      // rating isn't in the POST writable set; PUT to apply.
      const { body: createdMatched } = await req('POST', '/api/books', { title: 'rating filter — match' });
      const { body: matched } = await req('PUT', `/api/books/${createdMatched.id}`, {
        ...createdMatched, rating: 4.5, tags: [],
      });
      const { body: createdOther } = await req('POST', '/api/books', { title: 'rating filter — other' });
      const { body: other } = await req('PUT', `/api/books/${createdOther.id}`, {
        ...createdOther, rating: 3, tags: [],
      });
      const { body: results } = await req('GET', '/api/books?field=rating&value=4.5&limit=200');
      const ids = results.books.map(b => b.id);
      assert.ok( ids.includes(matched.id), 'expected field=rating&value=4.5 to include the 4.5-rated book');
      assert.ok(!ids.includes(other.id),   'expected field=rating&value=4.5 to exclude the 3-rated book');
    });

    it('field=year_finished orders by date_finished ASC within the year', async () => {
      // buildOrderBy() returns "date_finished ASC" specifically for field=year_finished,
      // giving end-of-year retrospectives a chronological view. Insert in reverse
      // chronological order to confirm the SQL sort, not insertion order.
      const { body: later } = await req('POST', '/api/books', {
        title: 'year_finished order — Sep 2027', date_finished: '2027-09-15',
      });
      const { body: earlier } = await req('POST', '/api/books', {
        title: 'year_finished order — Mar 2027', date_finished: '2027-03-22',
      });
      const { body: results } = await req('GET', '/api/books?field=year_finished&value=2027&limit=200');
      const ids = results.books.map(b => b.id);
      const earlierIdx = ids.indexOf(earlier.id);
      const laterIdx   = ids.indexOf(later.id);
      assert.ok(earlierIdx >= 0 && laterIdx >= 0, 'both fixtures should be in result');
      assert.ok(earlierIdx < laterIdx,
        `expected earlier (#${earlier.id} Mar) before later (#${later.id} Sep); got positions ${earlierIdx}, ${laterIdx}`);
    });

    it('field=year_finished filters by date_finished year prefix', async () => {
      // Branch: date_finished LIKE 'YYYY%'. Different dates within the year
      // should match; dates in other years should not.
      const { body: matched } = await req('POST', '/api/books', {
        title: 'year_finished — 2023 read', date_finished: '2023-06-15',
      });
      const { body: other } = await req('POST', '/api/books', {
        title: 'year_finished — 2024 read', date_finished: '2024-03-10',
      });
      const { body: results } = await req('GET', '/api/books?field=year_finished&value=2023&limit=200');
      const ids = results.books.map(b => b.id);
      assert.ok( ids.includes(matched.id), 'expected field=year_finished&value=2023 to include the 2023-finished book');
      assert.ok(!ids.includes(other.id),   'expected field=year_finished&value=2023 to exclude the 2024-finished book');
    });

    it('field=year_acquired orders by acquisition_date ASC within the year', async () => {
      // Same shape as year_finished — buildOrderBy returns
      // "acquisition_date ASC" for field=year_acquired. Insert in reverse
      // chronological order to confirm the SQL sort. owned: true is required
      // because repository.js nulls acquisition_date on unowned books
      // (mirrors the AcquisitionFields UI gating).
      const { body: later } = await req('POST', '/api/books', {
        title: 'year_acquired order — Nov 2029', acquisition_date: '2029-11-04', owned: true,
      });
      const { body: earlier } = await req('POST', '/api/books', {
        title: 'year_acquired order — Feb 2029', acquisition_date: '2029-02-18', owned: true,
      });
      try {
        const { body: results } = await req('GET', '/api/books?field=year_acquired&value=2029&limit=200');
        const ids = results.books.map(b => b.id);
        const earlierIdx = ids.indexOf(earlier.id);
        const laterIdx   = ids.indexOf(later.id);
        assert.ok(earlierIdx >= 0 && laterIdx >= 0, 'both fixtures should be in result');
        assert.ok(earlierIdx < laterIdx,
          `expected earlier (#${earlier.id} Feb) before later (#${later.id} Nov); got positions ${earlierIdx}, ${laterIdx}`);
      } finally {
        // Keep the in-memory test DB below the 200-row cap that the
        // downstream sort=author test relies on.
        for (const id of [later.id, earlier.id]) await req('DELETE', `/api/books/${id}`);
      }
    });

    it('field=year_acquired filters by acquisition_date year prefix', async () => {
      // Branch: acquisition_date LIKE 'YYYY%'. Year-only acquisition_date
      // should also match the prefix (the column stores partial dates as
      // substrings; LIKE 'YYYY%' catches both 'YYYY' and 'YYYY-MM-DD').
      const { body: matched } = await req('POST', '/api/books', {
        title: 'year_acquired — 2028 full',     acquisition_date: '2028-05-19', owned: true,
      });
      const { body: partial } = await req('POST', '/api/books', {
        title: 'year_acquired — 2028 yearonly', acquisition_date: '2028',      owned: true,
      });
      const { body: other } = await req('POST', '/api/books', {
        title: 'year_acquired — 2027 full',     acquisition_date: '2027-08-10', owned: true,
      });
      try {
        const { body: results } = await req('GET', '/api/books?field=year_acquired&value=2028&limit=200');
        const ids = results.books.map(b => b.id);
        assert.ok( ids.includes(matched.id), 'expected field=year_acquired&value=2028 to include the full-date 2028 book');
        assert.ok( ids.includes(partial.id), 'expected field=year_acquired&value=2028 to include the year-only 2028 book');
        assert.ok(!ids.includes(other.id),   'expected field=year_acquired&value=2028 to exclude the 2027 book');
      } finally {
        for (const id of [matched.id, partial.id, other.id]) await req('DELETE', `/api/books/${id}`);
      }
    });

    it('field=fiction routes value=fiction/nonfiction/unset to the right sub-branch', async () => {
      // lib/books/filters.js has three sub-branches under f === 'fiction':
      // value='fiction' → fiction=1, value='nonfiction' → fiction=0, anything
      // else (incl. 'unset' from Stats.jsx) → fiction IS NULL.
      const { body: novel    } = await req('POST', '/api/books', { title: 'fiction-branch novel',     fiction: true  });
      const { body: nonfic   } = await req('POST', '/api/books', { title: 'fiction-branch nonfic',    fiction: false });
      const { body: unset    } = await req('POST', '/api/books', { title: 'fiction-branch unset' });

      const cases = [
        { value: 'fiction',    matched: novel,  excluded: [nonfic, unset] },
        { value: 'nonfiction', matched: nonfic, excluded: [novel,  unset] },
        { value: 'unset',      matched: unset,  excluded: [novel,  nonfic] },
      ];
      for (const c of cases) {
        const { body: results } = await req('GET', `/api/books?field=fiction&value=${c.value}&limit=200`);
        const ids = results.books.map(b => b.id);
        assert.ok(ids.includes(c.matched.id),
          `expected field=fiction&value=${c.value} to include the matched fixture`);
        for (const ex of c.excluded) {
          assert.ok(!ids.includes(ex.id),
            `expected field=fiction&value=${c.value} to exclude fixture #${ex.id}`);
        }
      }
    });

    it('GET /api/books/counts returns status totals with all aliased to total', async () => {
      const { body: before } = await req('GET', '/api/books/counts');
      const { status: postStatus } = await req('POST', '/api/books', {
        title: 'counts-fixture ' + Math.random().toString(36).slice(2, 8),
        // status defaults to 'unread' on creation.
      });
      assert.equal(postStatus, 201);
      const { body: after } = await req('GET', '/api/books/counts');

      assert.equal(after.total,  before.total  + 1, 'total should increment by 1');
      assert.equal(after.all,    before.all    + 1, 'all should increment by 1');
      assert.equal(after.unread, before.unread + 1, 'unread should increment by 1');
      assert.equal(after.all,    after.total,       'all should always equal total');
    });

    it('GET /api/books/counts increments reading and finished counters', async () => {
      // Mirrors the unread-default test above for the remaining statuses, which
      // back the tab badges on Library and would silently break if their SUM
      // expression in repository.js were typo'd.
      const cases = [
        { status: 'reading' },
        { status: 'finished', date_finished: '2024-01-01' },
      ];
      for (const { status, ...rest } of cases) {
        const { body: before } = await req('GET', '/api/books/counts');
        await req('POST', '/api/books', {
          title: `counts-${status} ` + Math.random().toString(36).slice(2, 8),
          status, ...rest,
        });
        const { body: after } = await req('GET', '/api/books/counts');
        assert.equal(after[status], before[status] + 1, `${status} should increment by 1`);
        assert.equal(after.total, before.total + 1, `total should increment by 1 for ${status}`);
      }
    });

    it('GET /api/books/counts increments owned and prev_owned counters', async () => {
      // The counts row also exposes ownership totals. previously_owned is
      // forced to 0 when owned=true (see updateBook), so the prev_owned
      // fixture must explicitly send owned: false. The custom-owned and
      // Internet-owned fixtures are regression checks for the broadened
      // semantics: Owned means "I have a copy I can read", regardless of
      // provenance — so all three owned=1 fixtures bump the counter.
      const { body: before } = await req('GET', '/api/books/counts');
      await req('POST', '/api/books', {
        title: 'counts-owned ' + Math.random().toString(36).slice(2, 8), owned: true,
      });
      await req('POST', '/api/books', {
        title: 'counts-prev '  + Math.random().toString(36).slice(2, 8),
        owned: false, previously_owned: true,
      });
      await req('POST', '/api/books', {
        title: 'counts-cstm ' + Math.random().toString(36).slice(2, 8),
        owned: true, is_custom: true,
      });
      await req('POST', '/api/books', {
        title: 'counts-net '  + Math.random().toString(36).slice(2, 8),
        owned: true, acquisition_source: 'Internet',
      });
      const { body: after } = await req('GET', '/api/books/counts');

      assert.equal(after.owned,      before.owned      + 3, 'owned should increment by 3 (real + custom + Internet all count)');
      assert.equal(after.prev_owned, before.prev_owned + 1, 'prev_owned should increment by 1');
    });

    it('tab=owned includes custom and Internet-sourced books — Owned means "I have a copy"', async () => {
      // The Owned tab represents "I have a copy I can read", regardless
      // of provenance: purchased media, side-loaded ebooks, and user-
      // assembled custom rows all count alike. Provenance lives on the
      // acquisition_source field for narrower views; the Owned tab/count
      // is the broad "library size" concept.
      const { body: ownedReal }   = await req('POST', '/api/books', { title: 'Owned real owned-test',   owned: true });
      const { body: ownedCustom } = await req('POST', '/api/books', { title: 'Owned custom owned-test', owned: true, is_custom: true });
      const { body: ownedNet }    = await req('POST', '/api/books', { title: 'Owned net owned-test',    owned: true, acquisition_source: 'Internet' });

      const { body: list } = await req('GET', '/api/books?tab=owned&limit=200');
      const ids = list.books.map(b => b.id);
      assert.ok(ids.includes(ownedReal.id),   'owned real book should appear');
      assert.ok(ids.includes(ownedCustom.id), 'owned custom book should appear on Owned tab (broad meaning)');
      assert.ok(ids.includes(ownedNet.id),    'owned Internet-sourced book should appear on Owned tab (broad meaning)');
    });

    it('GET /api/books/counts.never_owned counts only real books that are neither owned nor previously owned', async () => {
      // Four POSTs: only the plain never-owned fixture should increment
      // never_owned. The owned + prev fixtures land in their own buckets,
      // and the custom fixture is excluded because the Never owned tab is
      // for purchase decisions and custom books aren't purchasable.
      const { body: before } = await req('GET', '/api/books/counts');
      await req('POST', '/api/books', { title: 'no-owned '  + Math.random().toString(36).slice(2, 8), owned: true });
      await req('POST', '/api/books', { title: 'no-prev '   + Math.random().toString(36).slice(2, 8), owned: false, previously_owned: true });
      await req('POST', '/api/books', { title: 'no-never '  + Math.random().toString(36).slice(2, 8), owned: false, previously_owned: false });
      await req('POST', '/api/books', { title: 'no-custom ' + Math.random().toString(36).slice(2, 8), owned: false, previously_owned: false, is_custom: true });
      const { body: after } = await req('GET', '/api/books/counts');

      assert.equal(after.never_owned, before.never_owned + 1, 'never_owned should increment by 1 (custom excluded)');
    });

    it('tab=never_owned returns only real books with owned=0, previously_owned=0, is_custom=0', async () => {
      const { body: ownedBook }     = await req('POST', '/api/books', { title: 'Owned never-owned-test',    owned: true });
      const { body: prevBook }      = await req('POST', '/api/books', { title: 'Prev never-owned-test',     owned: false, previously_owned: true });
      const { body: neverBook }     = await req('POST', '/api/books', { title: 'Never never-owned-test',    owned: false, previously_owned: false });
      const { body: customBook }    = await req('POST', '/api/books', { title: 'Custom never-owned-test',   owned: false, previously_owned: false, is_custom: true });
      const { body: archivedNever } = await req('POST', '/api/books', { title: 'Archived never-owned-test', owned: false, previously_owned: false, archived: true });

      const { body: list } = await req('GET', '/api/books?tab=never_owned&limit=200');
      const ids = list.books.map(b => b.id);
      assert.ok( ids.includes(neverBook.id),     'never-owned book should appear');
      assert.ok(!ids.includes(ownedBook.id),     'owned book should NOT appear');
      assert.ok(!ids.includes(prevBook.id),      'prev-owned book should NOT appear');
      assert.ok(!ids.includes(customBook.id),    'custom book should NOT appear (not purchasable)');
      assert.ok(!ids.includes(archivedNever.id), 'archived never-owned book should NOT appear (archived excluded by default)');
    });

    it('PUT /api/books/desire-order writes desire_rank in the order received and sort=custom returns ranked first', async () => {
      // Three never-owned fixtures + one ranked-but-since-owned to confirm
      // the rank persists harmlessly on books that leave the never-owned set.
      const { body: a } = await req('POST', '/api/books', { title: 'Desire A ' + Math.random().toString(36).slice(2, 6), owned: false, previously_owned: false });
      const { body: b } = await req('POST', '/api/books', { title: 'Desire B ' + Math.random().toString(36).slice(2, 6), owned: false, previously_owned: false });
      const { body: c } = await req('POST', '/api/books', { title: 'Desire C ' + Math.random().toString(36).slice(2, 6), owned: false, previously_owned: false });

      // Server writes index → desire_rank. Order chosen as B, A, C so the
      // result isn't degenerate insertion order.
      const orderResp = await req('PUT', '/api/books/desire-order', { ids: [b.id, a.id, c.id] });
      assert.equal(orderResp.status, 200);
      assert.deepEqual(orderResp.body, { ok: true });

      const { body: list } = await req('GET', '/api/books?tab=never_owned&sort=custom&limit=200');
      const ids = list.books.map(x => x.id);
      const idxA = ids.indexOf(a.id), idxB = ids.indexOf(b.id), idxC = ids.indexOf(c.id);
      assert.ok(idxB >= 0 && idxA >= 0 && idxC >= 0, 'all three should appear');
      assert.ok(idxB < idxA && idxA < idxC, 'order should follow PUT order: B, A, C');
    });

    it('PUT /api/books/desire-order rejects non-integer ids', async () => {
      const { status, body } = await req('PUT', '/api/books/desire-order', { ids: ['nope', -1] });
      assert.equal(status, 400);
      assert.match(body.error, /positive integers/);
    });

    it('POST /api/books/:id/fetch-cover returns 400 when book has no ISBN', async () => {
      // The route short-circuits with "No ISBN on this book" before any network
      // lookup, so this stays hermetic.
      const { body: created } = await req('POST', '/api/books', {
        title: 'no-isbn cover ' + Math.random().toString(36).slice(2, 6),
      });
      const { status, body } = await req('POST', `/api/books/${created.id}/fetch-cover`, {});
      assert.equal(status, 400);
      assert.equal(body.error, 'No ISBN on this book');
    });

    it('POST /api/books/:id/fetch-cover returns 404 for unknown book id', async () => {
      // notFound is resolved before any cover lookup, so this stays hermetic.
      const { status, body } = await req('POST', '/api/books/999999/fetch-cover', {});
      assert.equal(status, 404);
      assert.equal(body.error, 'Not found');
    });

    it('POST /api/books/:id/fetch-cover returns 400 for invalid book id', async () => {
      // The id parser rejects non-integer / <1 ids before any repository work.
      const { status, body } = await req('POST', '/api/books/nope/fetch-cover', {});
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid book id');
    });

    it('POST /api/books/:id/fetch-cover saves a fetched cover and returns the updated book', async () => {
      // Mock Google Books → returns a usable image URL; mock the image fetch
      // → returns a tiny JPEG buffer; mock fs.promises.writeFile so nothing
      // touches disk. The route should run end-to-end and surface a
      // cover_path like /uploads/<filename>.jpg.
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover-happy ' + Math.random().toString(36).slice(2, 6),
        isbn_13: '9780000000001',
      });
      const jpeg = new Uint8Array(3000);
      jpeg[0] = 0xFF; jpeg[1] = 0xD8; jpeg[2] = 0xFF; jpeg[3] = 0xE0;
      const arrBuf = jpeg.buffer.slice(0);
      const writeMock = mock.method(fs.promises, 'writeFile', async () => {});
      const originalFetch = globalThis.fetch;
      const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
        const targetStr = typeof target === 'string' ? target : String(target);
        if (targetStr.startsWith(url)) return originalFetch(target, init);
        if (targetStr.includes('googleapis.com')) {
          return { ok: true, json: async () => ({
            items: [{ volumeInfo: { imageLinks: { thumbnail: 'http://example.test/cover.jpg' } } }],
          }) };
        }
        if (targetStr.includes('example.test')) {
          return { ok: true, arrayBuffer: async () => arrBuf };
        }
        return { ok: false };
      });
      try {
        const { status, body } = await req('POST', `/api/books/${created.id}/fetch-cover`, {});
        assert.equal(status, 200);
        assert.match(body.cover_path, /^\/uploads\/\d+-[a-z0-9]+\.jpg$/i);
        assert.equal(writeMock.mock.callCount(), 1, 'image should be written exactly once');
      } finally {
        writeMock.mock.restore();
        fetchMock.mock.restore();
      }
    });

    it('POST /api/books/:id/fetch-cover deletes the old local cover after replacement', async () => {
      // Book starts with a stored safe cover filename. After fetch-cover
      // succeeds, repository.js:323 should call deleteLocalCover with the old
      // filename so we don't leak the file. fs.unlink is the boundary.
      const oldFilename = '1234567890-abcdefg.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'cover-replace ' + Math.random().toString(36).slice(2, 6),
        isbn_13: '9780000000002',
        cover_path: `/uploads/${oldFilename}`,
      });
      const jpeg = new Uint8Array(3000);
      jpeg[0] = 0xFF; jpeg[1] = 0xD8; jpeg[2] = 0xFF; jpeg[3] = 0xE0;
      const arrBuf = jpeg.buffer.slice(0);
      const writeMock = mock.method(fs.promises, 'writeFile', async () => {});
      const unlinkMock = mock.method(fs, 'unlink', (_p, cb) => cb(null));
      const originalFetch = globalThis.fetch;
      const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
        const targetStr = typeof target === 'string' ? target : String(target);
        if (targetStr.startsWith(url)) return originalFetch(target, init);
        if (targetStr.includes('googleapis.com')) {
          return { ok: true, json: async () => ({
            items: [{ volumeInfo: { imageLinks: { thumbnail: 'http://example.test/cover.jpg' } } }],
          }) };
        }
        if (targetStr.includes('example.test')) {
          return { ok: true, arrayBuffer: async () => arrBuf };
        }
        return { ok: false };
      });
      try {
        const { status } = await req('POST', `/api/books/${created.id}/fetch-cover`, {});
        assert.equal(status, 200);
        assert.equal(unlinkMock.mock.callCount(), 1, 'old cover should be unlinked exactly once');
        const unlinkPath = unlinkMock.mock.calls[0].arguments[0];
        assert.ok(unlinkPath.endsWith(oldFilename),
          `expected unlink path to end in ${oldFilename}, got: ${unlinkPath}`);
      } finally {
        writeMock.mock.restore();
        unlinkMock.mock.restore();
        fetchMock.mock.restore();
      }
    });

    it('POST /api/books/:id/fetch-cover returns 404 when no remote cover is found', async () => {
      // Book has an ISBN so the no-ISBN guard doesn't fire; both Google Books
      // and Open Library are mocked to return no usable cover, so
      // updateBookCover() resolves with coverNotFound → 404.
      const { body: created } = await req('POST', '/api/books', {
        title: 'no-cover ' + Math.random().toString(36).slice(2, 6),
        isbn_13: '9999999999999',
      });
      const originalFetch = globalThis.fetch;
      const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
        const targetStr = typeof target === 'string' ? target : String(target);
        if (targetStr.startsWith(url)) return originalFetch(target, init);
        if (targetStr.includes('googleapis.com')) {
          return { ok: true, json: async () => ({ items: [] }) };
        }
        return { ok: false }; // Open Library fallback
      });
      try {
        const { status, body } = await req('POST', `/api/books/${created.id}/fetch-cover`, {});
        assert.equal(status, 404);
        assert.equal(body.error, 'Cover image not found');
      } finally {
        fetchMock.mock.restore();
      }
    });

    it('normalizes cover_path on list responses through toCoverUrl', async () => {
      // The list path passes each row's stored filename through toCoverUrl,
      // which prepends /uploads/. POST accepts the full URL and toFilename
      // strips the prefix on storage; the list path must restore it.
      const stem = 'coverlist' + Math.random().toString(36).slice(2, 6);
      const coverUrl = '/uploads/1234567890-abcdef.webp';
      const { body: created } = await req('POST', '/api/books', {
        title: `${stem} cover roundtrip`, cover_path: coverUrl,
      });
      const { body } = await req('GET', `/api/books?q=${stem}&limit=200`);
      const item = body.books.find(b => b.id === created.id);
      assert.ok(item, 'expected the fixture to appear in list response');
      assert.equal(item.cover_path, coverUrl,
        `expected list response to preserve /uploads/ URL through round-trip; got ${item.cover_path}`);
    });

    it('appends virtual tags to list responses', async () => {
      // listBooks() spreads computeVirtualTags(b) into each item's tags array.
      // Abridged is the cheapest trigger — a single boolean — and the virtual
      // entry has shape { id: null, name, virtual: true }.
      const stem = 'vtaglist' + Math.random().toString(36).slice(2, 6);
      const { body: created } = await req('POST', '/api/books', {
        title: `${stem} abridged`, abridged: true,
      });
      const { body } = await req('GET', `/api/books?q=${stem}&limit=200`);
      const item = body.books.find(b => b.id === created.id);
      assert.ok(item, 'expected the fixture to appear in list response');
      const abridgedTag = item.tags.find(t => t.name === 'Abridged');
      assert.ok(abridgedTag, `expected list item tags to include Abridged virtual tag; got ${JSON.stringify(item.tags)}`);
      assert.equal(abridgedTag.virtual, true,  'virtual tag should carry virtual: true');
      assert.equal(abridgedTag.id,      null,  'virtual tag should have id: null');
    });

    it('hydrates tags/authors/narrators/translators on list responses', async () => {
      // listBooks() runs four separate IN-clause queries to attach joined
      // collections to each row. Existing coverage exercises filter logic and
      // individual GETs but doesn't assert the LIST path's hydration directly.
      const stem = 'hydrate' + Math.random().toString(36).slice(2, 6);
      const { body: created } = await req('POST', '/api/books', {
        title: `${stem} fully joined`,
        authors:     [`${stem}-Author A`, `${stem}-Author B`],
        narrators:   [`${stem}-Narrator`],
        translators: [`${stem}-Translator`],
        tags:        [`${stem}-tagX`, `${stem}-tagY`],
      });

      const { body } = await req('GET', `/api/books?q=${stem}&limit=200`);
      const item = body.books.find(b => b.id === created.id);
      assert.ok(item, 'expected the fixture to appear in list response');
      assert.deepEqual(item.authors.map(a => a.name),
        [`${stem}-Author A`, `${stem}-Author B`], 'list authors hydrated in position order');
      assert.deepEqual(item.narrators.map(n => n.name),
        [`${stem}-Narrator`], 'list narrators hydrated');
      assert.deepEqual(item.translators.map(t => t.name),
        [`${stem}-Translator`], 'list translators hydrated');
      const tagNames = item.tags.map(t => t.name).sort();
      assert.deepEqual(tagNames, [`${stem}-tagX`, `${stem}-tagY`],
        'list tags hydrated');
    });

    it('falls back to updated_at DESC for unknown sort values', async () => {
      // buildOrderBy()'s default branch sorts by updated_at DESC. SQLite stores
      // datetime('now','localtime') at second precision, so we sleep briefly
      // before the PUT to guarantee distinct timestamps between the two books.
      const stem = 'defsort' + Math.random().toString(36).slice(2, 6);
      const { body: bookA } = await req('POST', '/api/books', { title: `${stem}-A` });
      const { body: bookB } = await req('POST', '/api/books', { title: `${stem}-B` });
      await new Promise(r => setTimeout(r, 1100));
      // PUT touches updated_at unconditionally; just resend the existing payload.
      await req('PUT', `/api/books/${bookA.id}`, { ...bookA, tags: [] });

      const { body } = await req('GET', '/api/books?sort=not-a-real-sort&limit=500');
      const ids = body.books.map(b => b.id);
      const iA = ids.indexOf(bookA.id);
      const iB = ids.indexOf(bookB.id);
      assert.ok(iA >= 0 && iB >= 0, 'both fixtures should appear');
      assert.ok(iA < iB,
        `expected updated bookA before untouched bookB; got positions A=${iA}, B=${iB}`);
    });

    it('clamps out-of-range limit and offset', async () => {
      // listBooks() clamps limit to [1,200] and offset to >=0. Verify the
      // response echoes the clamped values rather than the raw query params.
      const { body } = await req('GET', '/api/books?limit=999&offset=-5');
      assert.equal(body.limit,  200, `expected limit clamped to 200, got ${body.limit}`);
      assert.equal(body.offset, 0,   `expected offset clamped to 0, got ${body.offset}`);
    });

    it('paginates with limit/offset and returns matching response shape', async () => {
      // listBooks() clamps limit to [1,200] and offset to ≥0, then echoes both
      // back in the response alongside total. Insert in order so sort=added
      // produces [C, B, A] DESC; offset=1+limit=1 isolates the middle book.
      const stem = 'paginate' + Math.random().toString(36).slice(2, 6);
      const { body: bookA } = await req('POST', '/api/books', { title: `${stem}-A` });
      const { body: bookB } = await req('POST', '/api/books', { title: `${stem}-B` });
      const { body: bookC } = await req('POST', '/api/books', { title: `${stem}-C` });

      const { body } = await req('GET', `/api/books?q=${stem}&sort=added&limit=1&offset=1`);
      assert.equal(body.total,  3, `expected total=3 books matching '${stem}'`);
      assert.equal(body.limit,  1, 'expected limit echoed back');
      assert.equal(body.offset, 1, 'expected offset echoed back');
      assert.equal(body.books.length, 1, 'expected exactly one book on the page');
      assert.equal(body.books[0].id, bookB.id,
        `expected the middle book (#${bookB.id}) at offset=1; got #${body.books[0].id}`);
      // Touch other ids to avoid unused-var lint and document intent.
      assert.notEqual(body.books[0].id, bookA.id);
      assert.notEqual(body.books[0].id, bookC.id);
    });

    it('sort=added orders by id DESC (newest first)', async () => {
      const stem = 'addsort' + Math.random().toString(36).slice(2, 6);
      const { body: first  } = await req('POST', '/api/books', { title: `${stem}-first`  });
      const { body: second } = await req('POST', '/api/books', { title: `${stem}-second` });

      const { body: results } = await req('GET', '/api/books?sort=added&limit=500');
      const ids = results.books.map(b => b.id);
      const iFirst  = ids.indexOf(first.id);
      const iSecond = ids.indexOf(second.id);
      assert.ok(iFirst >= 0 && iSecond >= 0, 'both fixtures should appear');
      assert.ok(iSecond < iFirst,
        `expected newer book first; got positions first=${iFirst}, second=${iSecond}`);
    });

    it('sort=started/finished orders DESC with undated books last', async () => {
      // Both branches use COALESCE(date_*,''), so the empty string sinks to the
      // bottom under DESC. Same shape across the two columns.
      const cases = [
        { sort: 'started',  col: 'date_started'  },
        { sort: 'finished', col: 'date_finished' },
      ];
      for (const c of cases) {
        const stem = `${c.sort}sort` + Math.random().toString(36).slice(2, 6);
        const { body: recent }  = await req('POST', '/api/books', { title: `${stem}-recent`, [c.col]: '2026-04-01' });
        const { body: older }   = await req('POST', '/api/books', { title: `${stem}-older`,  [c.col]: '2024-01-01' });
        const { body: undated } = await req('POST', '/api/books', { title: `${stem}-undated` });

        const { body: results } = await req('GET', `/api/books?sort=${c.sort}&limit=500`);
        const ids = results.books.map(b => b.id);
        const iRecent  = ids.indexOf(recent.id);
        const iOlder   = ids.indexOf(older.id);
        const iUndated = ids.indexOf(undated.id);
        assert.ok(iRecent >= 0 && iOlder >= 0 && iUndated >= 0,
          `all three ${c.sort} fixtures should appear`);
        assert.ok(iRecent < iOlder && iOlder < iUndated,
          `expected sort=${c.sort} order [recent, older, undated]; got positions ${iRecent}, ${iOlder}, ${iUndated}`);
      }
    });

    it('sort=random returns the same order for the same seed (paginates stably)', async () => {
      const { body: page1 } = await req('GET', '/api/books?sort=random&seed=42&limit=50&offset=0');
      const { body: page2 } = await req('GET', '/api/books?sort=random&seed=42&limit=50&offset=50');
      const { body: again } = await req('GET', '/api/books?sort=random&seed=42&limit=50&offset=0');
      assert.deepEqual(page1.books.map(b => b.id), again.books.map(b => b.id),
        'same seed + offset must yield identical ids');
      // No overlap between consecutive pages of a stable shuffle.
      const seen = new Set(page1.books.map(b => b.id));
      const overlap = page2.books.map(b => b.id).filter(id => seen.has(id));
      assert.equal(overlap.length, 0, `expected no overlap between paginated random pages, got ${overlap.length}`);
    });

    it('sort=random with different seeds returns different orders', async () => {
      const { body: a } = await req('GET', '/api/books?sort=random&seed=7&limit=50');
      const { body: b } = await req('GET', '/api/books?sort=random&seed=99&limit=50');
      // Two seeds against the same dataset should land on different orders
      // for at least one position; allow ties only if the dataset is tiny.
      if (a.books.length < 5) return;
      const sameOrder = a.books.every((bk, i) => b.books[i]?.id === bk.id);
      assert.ok(!sameOrder, 'different seeds should produce different orderings');
    });

    it('sort=progress branches by format and sorts highest ratio first', async () => {
      // The progress sort uses CASE WHEN format='audiobook' THEN current_minutes/duration_minutes
      // ELSE current_page/page_count, so the ratio is computed in the right unit per book.
      // current_page/current_minutes are PATCH-only, so each fixture needs a POST+PATCH.
      const stem = 'progsort' + Math.random().toString(36).slice(2, 6);
      const { body: pbook } = await req('POST', '/api/books', {
        title: `${stem}-physical`, format: 'physical', page_count: 100,
      });
      await req('PATCH', `/api/books/${pbook.id}`, { current_page: 50 });   // 50%
      const { body: abook } = await req('POST', '/api/books', {
        title: `${stem}-audio`, format: 'audiobook', duration_minutes: 100,
      });
      await req('PATCH', `/api/books/${abook.id}`, { current_minutes: 25 }); // 25%
      const { body: empty } = await req('POST', '/api/books', { title: `${stem}-empty` });

      const { body: results } = await req('GET', '/api/books?sort=progress&limit=500');
      const ids = results.books.map(b => b.id);
      const iP = ids.indexOf(pbook.id);
      const iA = ids.indexOf(abook.id);
      const iE = ids.indexOf(empty.id);
      assert.ok(iP >= 0 && iA >= 0 && iE >= 0, 'all three fixtures should appear');
      assert.ok(iP < iA && iA < iE,
        `expected order [physical 50%, audio 25%, empty]; got positions p=${iP}, a=${iA}, e=${iE}`);
    });

    it('sort=length uses COALESCE(page_count, duration_minutes, 0) DESC', async () => {
      // The production branch deliberately mixes pages and minutes through a
      // single COALESCE — a long audiobook (duration only) sorts above a
      // shorter page-count book; a length-less book sinks to the bottom.
      const stem = 'lensort' + Math.random().toString(36).slice(2, 6);
      const { body: pageBook } = await req('POST', '/api/books', {
        title: `${stem}-pages`, format: 'physical', page_count: 500,
      });
      const { body: audio } = await req('POST', '/api/books', {
        title: `${stem}-audio`, format: 'audiobook', duration_minutes: 600,
      });
      const { body: noneBook } = await req('POST', '/api/books', {
        title: `${stem}-empty`,
      });

      const { body: results } = await req('GET', '/api/books?sort=length&limit=500');
      const ids = results.books.map(b => b.id);
      const iAudio = ids.indexOf(audio.id);
      const iPages = ids.indexOf(pageBook.id);
      const iNone  = ids.indexOf(noneBook.id);
      assert.ok(iAudio >= 0 && iPages >= 0 && iNone >= 0, 'all three fixtures should appear');
      assert.ok(iAudio < iPages && iPages < iNone,
        `expected order [audio(600m), pages(500p), none]; got positions audio=${iAudio}, pages=${iPages}, none=${iNone}`);
    });

    it('sort=rating orders DESC with unrated books last', async () => {
      // buildOrderBy()'s rating branch is COALESCE(rating,0) DESC, so unrated
      // (NULL) coalesces to 0 and sinks below any rated book.
      // rating isn't in the POST writable set; use PUT for the rated fixtures.
      const stem = 'ratesort' + Math.random().toString(36).slice(2, 6);
      const { body: c5 } = await req('POST', '/api/books', { title: `${stem}-five` });
      const { body: r5 } = await req('PUT',  `/api/books/${c5.id}`, { ...c5, rating: 5, tags: [] });
      const { body: c3 } = await req('POST', '/api/books', { title: `${stem}-three` });
      const { body: r3 } = await req('PUT',  `/api/books/${c3.id}`, { ...c3, rating: 3, tags: [] });
      const { body: unrated } = await req('POST', '/api/books', { title: `${stem}-unrated` });

      const { body: results } = await req('GET', '/api/books?sort=rating&limit=500');
      const ids = results.books.map(b => b.id);
      const i5 = ids.indexOf(r5.id);
      const i3 = ids.indexOf(r3.id);
      const iU = ids.indexOf(unrated.id);
      assert.ok(i5 >= 0 && i3 >= 0 && iU >= 0, 'all three fixtures should appear');
      assert.ok(i5 < i3 && i3 < iU,
        `expected order [5, 3, unrated]; got positions 5=${i5}, 3=${i3}, unrated=${iU}`);
    });

    it('sort=author orders by the first joined author (position 0)', async () => {
      // buildOrderBy()'s author-sort SELECTs ORDER BY ba.position LIMIT 1, so a
      // multi-author book sorts on its first author only. Pick names so that the
      // first-author and last-author rules would produce different orderings:
      //   single  → "Mendel ..."
      //   multi   → ["Aalbrecht ...", "Zylphinax ..."]
      // First-author rule: multi (Aalbrecht) before single (Mendel).
      // Last-author rule:  single (Mendel) before multi (Zylphinax).
      const stem = 'authsort' + Math.random().toString(36).slice(2, 6);
      const single = await req('POST', '/api/books', {
        title: `${stem}-A`, authors: [`Mendel ${stem}`],
      });
      const multi = await req('POST', '/api/books', {
        title: `${stem}-B`, authors: [`Aalbrecht ${stem}`, `Zylphinax ${stem}`],
      });

      const { body: results } = await req('GET', '/api/books?sort=author&limit=500');
      const ids = results.books.map(b => b.id);
      const iSingle = ids.indexOf(single.body.id);
      const iMulti  = ids.indexOf(multi.body.id);
      assert.ok(iSingle >= 0 && iMulti >= 0, 'both fixtures should appear in result');
      assert.ok(iMulti < iSingle,
        `expected multi-author (first=Aalbrecht) before single-author (Mendel); got positions multi=${iMulti}, single=${iSingle}`);
    });

    it('sort=title strips leading The/An/A articles before sorting', async () => {
      // buildOrderBy()'s titleSort uses CASE/SUBSTR to strip leading "The ",
      // "An ", and "A " before sorting. Use unique-stem titles so we can find
      // our fixtures unambiguously among the test-DB's other books.
      const stem = 'titlesort' + Math.random().toString(36).slice(2, 8);
      const { body: zebra } = await req('POST', '/api/books', { title: `The ${stem}-zebra` });
      const { body: apple } = await req('POST', '/api/books', { title: `${stem}-apple` });
      const { body: moon  } = await req('POST', '/api/books', { title: `A ${stem}-moon` });

      const { body: results } = await req('GET', '/api/books?sort=title&limit=500');
      const ids = results.books.map(b => b.id);
      const [iApple, iMoon, iZebra] = [apple.id, moon.id, zebra.id].map(id => ids.indexOf(id));
      assert.ok(iApple >= 0 && iMoon >= 0 && iZebra >= 0, 'all three fixtures should appear in result');
      // Normalized order: -apple, -moon, -zebra (articles stripped).
      assert.ok(iApple < iMoon  && iMoon < iZebra,
        `expected normalized order [-apple, -moon, -zebra]; got positions ${iApple}, ${iMoon}, ${iZebra}`);
    });

    it('field=series orders results by series_number with null last', async () => {
      // buildOrderBy() in lib/books/filters.js uses COALESCE(series_number,9999)
      // when field === 'series', so unnumbered entries (e.g. companion volumes)
      // sort to the end of the series view rather than collapsing to position 0.
      const seriesName = 'Order-Branch Series ' + Math.random().toString(36).slice(2, 8);
      // Insert out of order to confirm SQL sorts, not insertion order.
      const { body: two } = await req('POST', '/api/books', {
        title: `${seriesName} two`, series: seriesName, series_number: 2,
      });
      const { body: nullbook } = await req('POST', '/api/books', {
        title: `${seriesName} companion`, series: seriesName, // no series_number
      });
      const { body: one } = await req('POST', '/api/books', {
        title: `${seriesName} one`, series: seriesName, series_number: 1,
      });

      const { body: results } = await req('GET',
        `/api/books?field=series&value=${encodeURIComponent(seriesName)}&limit=200`);
      const ids = results.books.map(b => b.id);
      assert.deepEqual(ids, [one.id, two.id, nullbook.id],
        `expected [#1 first, #2 next, unnumbered last]; got ${JSON.stringify(ids)}`);
    });

    it('field=publisher/series/language/format filter by scalar value', async () => {
      // BROWSE_FIELDS in lib/books/filters.js use a catch-all `${col} = ?` branch
      // distinct from the people-field subqueries. This guards that branch.
      const cases = [
        { field: 'publisher', col: 'publisher', match: 'Scalar Browse Press Co',  other: 'Scalar Browse Other Press' },
        { field: 'series',    col: 'series',    match: 'Scalar Browse Series A',  other: 'Scalar Browse Series B' },
        { field: 'language',  col: 'language',  match: 'Klingon',                 other: 'Esperanto' },
        { field: 'format',    col: 'format',    match: 'physical',                other: 'audiobook' },
      ];
      for (const c of cases) {
        const { body: matched } = await req('POST', '/api/books', {
          title: `field=${c.field} match`, [c.col]: c.match,
        });
        const { body: other } = await req('POST', '/api/books', {
          title: `field=${c.field} other`, [c.col]: c.other,
        });
        const { body: results } = await req('GET',
          `/api/books?field=${c.field}&value=${encodeURIComponent(c.match)}&limit=200`);
        const ids = results.books.map(b => b.id);
        assert.ok(ids.includes(matched.id),
          `expected field=${c.field}&value=${c.match} to include the matching book`);
        assert.ok(!ids.includes(other.id),
          `expected field=${c.field}&value=${c.match} to exclude books with ${c.col}='${c.other}'`);
      }
    });

    it('field=author/narrator/translator filter by people name', async () => {
      const cases = [
        { field: 'author',     key: 'authors',     match: 'Browse Author',     other: 'Other Author' },
        { field: 'narrator',   key: 'narrators',   match: 'Browse Narrator',   other: 'Other Narrator' },
        { field: 'translator', key: 'translators', match: 'Browse Translator', other: 'Other Translator' },
      ];

      for (const c of cases) {
        const { body: matched } = await req('POST', '/api/books', {
          title: `${c.field} Browse Match`, [c.key]: [c.match],
        });
        const { body: other } = await req('POST', '/api/books', {
          title: `${c.field} Browse Other`, [c.key]: [c.other],
        });

        const { body: results } = await req('GET', `/api/books?field=${c.field}&value=${encodeURIComponent(c.match)}`);
        const ids = results.books.map(b => b.id);

        assert.ok(ids.includes(matched.id),
          `expected field=${c.field} to include books with the selected ${c.field}`);
        assert.ok(!ids.includes(other.id),
          `expected field=${c.field} to exclude books with a different ${c.field}`);
      }
    });

    it('missing[]=translator finds translated books with no translator entered', async () => {
      const { body: needs } = await req('POST', '/api/books', {
        title: 'Translated, no translator', original_language: 'German',
      });
      const { body: complete } = await req('POST', '/api/books', {
        title: 'Translated, has translator', original_language: 'Russian',
        translators: ['Constance Garnett'],
      });
      const { body: monolingual } = await req('POST', '/api/books', {
        title: 'Original English work', // no original_language
      });
      const { body: results } = await req('GET', '/api/books?missing[]=translator');
      const ids = results.books.map(b => b.id);
      assert.ok(ids.includes(needs.id),
        'expected book with original_language but no translator to match');
      assert.ok(!ids.includes(complete.id),
        'expected book with translator already entered to be excluded');
      assert.ok(!ids.includes(monolingual.id),
        'expected non-translated book to be excluded');
    });

    it('missing[]=source/acquired find owned books with no acquisition source/date', async () => {
      const cases = [
        { key: 'source',   col: 'acquisition_source', filledValue: 'Audible' },
        { key: 'acquired', col: 'acquisition_date',   filledValue: '2025-06' },
      ];
      for (const c of cases) {
        const { body: needs } = await req('POST', '/api/books', {
          title: `Owned, no ${c.key}`, owned: true,
        });
        const { body: filled } = await req('POST', '/api/books', {
          title: `Owned, has ${c.key}`, owned: true, [c.col]: c.filledValue,
        });
        const { body: unowned } = await req('POST', '/api/books', {
          title: `Unowned, no ${c.key}`, // owned defaults to false
        });
        const { body: results } = await req('GET', `/api/books?missing[]=${c.key}`);
        const ids = results.books.map(b => b.id);
        assert.ok(ids.includes(needs.id),
          `expected owned book missing ${c.key} to match`);
        assert.ok(!ids.includes(filled.id),
          `expected owned book with ${c.key} already entered to be excluded`);
        assert.ok(!ids.includes(unowned.id),
          `expected unowned book to be excluded from missing[]=${c.key}`);
      }
    });

    it('boolean filters owned/custom/loved include and exclude correctly on true and false', async () => {
      // Each of these has both true and false SQL branches in lib/books/filters.js.
      // The =false branches use COALESCE(col,0)=0 so NULL is treated as off.
      const cases = [
        { filter: 'owned',  onPayload: { owned:     true  }, offPayload: { owned:     false } },
        { filter: 'custom', onPayload: { is_custom: true  }, offPayload: { is_custom: false } },
        { filter: 'loved',  onPayload: { loved:     true  }, offPayload: { loved:     false } },
      ];
      for (const c of cases) {
        const { body: bookOn  } = await req('POST', '/api/books', { title: `${c.filter} on`,  ...c.onPayload  });
        const { body: bookOff } = await req('POST', '/api/books', { title: `${c.filter} off`, ...c.offPayload });

        const { body: trueRes } = await req('GET', `/api/books?${c.filter}=true&limit=200`);
        const trueIds = trueRes.books.map(b => b.id);
        assert.ok( trueIds.includes(bookOn.id),  `${c.filter}=true should include the on book`);
        assert.ok(!trueIds.includes(bookOff.id), `${c.filter}=true should exclude the off book`);

        const { body: falseRes } = await req('GET', `/api/books?${c.filter}=false&limit=200`);
        const falseIds = falseRes.books.map(b => b.id);
        assert.ok(!falseIds.includes(bookOn.id),  `${c.filter}=false should exclude the on book`);
        assert.ok( falseIds.includes(bookOff.id), `${c.filter}=false should include the off book`);
      }
    });

    it('previouslyOwned=true returns only books marked previously owned', async () => {
      // The backend has only a true branch for previouslyOwned (lib/books/filters.js:190).
      // previously_owned is forced to 0 when owned=true (repository.js:141), so the
      // matched fixture must explicitly set owned=false.
      const { body: prev } = await req('POST', '/api/books', {
        title: 'Previously Owned Book', owned: false, previously_owned: true,
      });
      const { body: never } = await req('POST', '/api/books', {
        title: 'Never Owned Book', owned: false,
      });
      const { body: results } = await req('GET', '/api/books?previouslyOwned=true&limit=200');
      const ids = results.books.map(b => b.id);
      assert.ok( ids.includes(prev.id),  'expected previously-owned book to match');
      assert.ok(!ids.includes(never.id), 'expected never-previously-owned book to be excluded');
    });

    it('combined []=empty + real value returns books matching either branch', async () => {
      // Covers the third SQL branch in lib/books/filters.js where hasEmpty && real.length:
      // (col IS NULL OR col IN (...)). The empty-only and real-only branches are
      // covered separately; this guards against a refactor breaking the OR.
      const cases = [
        { filter: 'publishers', col: 'publisher',          realMatched: 'Combined-Filter Press',     other: 'Combined-Filter Other Press' },
        { filter: 'series',     col: 'series',             realMatched: 'Combined-Filter Series A',  other: 'Combined-Filter Series B' },
        { filter: 'sources',    col: 'acquisition_source', realMatched: 'Combined-Filter Mart',      other: 'Combined-Filter Other Mart' },
        { filter: 'formats',    col: 'format',             realMatched: 'physical',                  other: 'audiobook' },
        { filter: 'ratings',    col: 'rating',             realMatched: 4,                           other: 5 },
      ];
      for (const c of cases) {
        const isRating = c.col === 'rating';

        async function makeBook(title, value) {
          if (isRating) {
            const { body: created } = await req('POST', '/api/books', { title });
            if (value == null) return created;
            const { body: updated } = await req('PUT', `/api/books/${created.id}`, {
              ...created, rating: value, tags: [],
            });
            return updated;
          }
          const payload = { title };
          if (value != null) payload[c.col] = value;
          // acquisition_source is server-nulled when (!owned && !previously_owned)
          // — set owned so the filled-source case actually persists.
          if (c.col === 'acquisition_source' && value != null) payload.owned = true;
          const { body } = await req('POST', '/api/books', payload);
          return body;
        }

        const matchedReal  = await makeBook(`${c.filter} combined — real`,  c.realMatched);
        const matchedEmpty = await makeBook(`${c.filter} combined — empty`, null);
        const otherBook    = await makeBook(`${c.filter} combined — other`, c.other);

        const realParam = encodeURIComponent(String(c.realMatched));
        const { body: results } = await req('GET',
          `/api/books?${c.filter}[]=empty&${c.filter}[]=${realParam}&limit=200`);
        const ids = results.books.map(b => b.id);

        assert.ok(ids.includes(matchedReal.id),
          `expected ${c.filter}[]=empty&${c.filter}[]=${c.realMatched} to include book with ${c.col}='${c.realMatched}'`);
        assert.ok(ids.includes(matchedEmpty.id),
          `expected combined filter to include book with no ${c.col}`);
        assert.ok(!ids.includes(otherBook.id),
          `expected combined filter to exclude book with ${c.col}='${c.other}'`);
      }
    });

    it('[]=empty filters across publishers/series/sources/formats/ratings return only books missing that field', async () => {
      // Each filter has its own SQL branch in lib/books/filters.js; this confirms
      // the IS NULL (or = '') branch works uniformly across all filters that
      // expose a — pill in the UI.
      const cases = [
        { filter: 'publishers', col: 'publisher',          filledValue: 'Empty-Filter Publisher Press' },
        { filter: 'series',     col: 'series',             filledValue: 'Empty-Filter Series Set' },
        { filter: 'sources',    col: 'acquisition_source', filledValue: 'Empty-Filter Mart' },
        { filter: 'formats',    col: 'format',             filledValue: 'physical' },
        { filter: 'ratings',    col: 'rating',             filledValue: 4 },
      ];
      for (const c of cases) {
        const { body: matched } = await req('POST', '/api/books', {
          title: `${c.filter} empty filter — no value`,
        });
        // ratings can't be set on POST creation; PUT after if the column needs it.
        let filled;
        if (c.col === 'rating') {
          const { body: created } = await req('POST', '/api/books', {
            title: `${c.filter} empty filter — has value`,
          });
          ({ body: filled } = await req('PUT', `/api/books/${created.id}`, {
            ...created, rating: c.filledValue, tags: [],
          }));
        } else {
          // acquisition_source is server-nulled when (!owned && !previously_owned)
          // per the gate in bookColumns. Set owned for the sources case so the
          // value actually persists and the filter has something to exclude.
          const extras = c.col === 'acquisition_source' ? { owned: true } : {};
          ({ body: filled } = await req('POST', '/api/books', {
            title: `${c.filter} empty filter — has value`,
            [c.col]: c.filledValue,
            ...extras,
          }));
        }
        // limit=200 since the in-memory DB accumulates books across tests in
        // this describe and the default 50-page would clip our fixture.
        const { body: results } = await req('GET', `/api/books?${c.filter}[]=empty&limit=200`);
        const ids = results.books.map(b => b.id);
        assert.ok(ids.includes(matched.id),
          `expected ${c.filter}[]=empty to include the book with no ${c.col}`);
        assert.ok(!ids.includes(filled.id),
          `expected ${c.filter}[]=empty to exclude the book with ${c.col}='${c.filledValue}'`);
      }
    });

    it('saves acquisition_source and acquisition_date', async () => {
      // owned: true so the acquisition fields aren't nulled by the
      // (!owned && !previously_owned) → null-acquisition gate in bookColumns.
      const { body } = await req('POST', '/api/books', {
        title: 'Sourced Book',
        owned: true,
        acquisition_source: 'Audible',
        acquisition_date: '2025-06',
      });
      assert.equal(body.acquisition_source, 'Audible');
      assert.equal(body.acquisition_date, '2025-06');
    });

    it('saves page_count for non-audiobooks and duration_minutes for audiobooks', async () => {
      // Format-gated columns: page_count is meaningless for audiobooks,
      // duration_minutes is meaningless for everything else (see
      // CoreFields.jsx:24-25 and bookColumns).
      const phys = await req('POST', '/api/books', {
        title: 'Long Book', format: 'physical', page_count: 800,
      });
      assert.equal(phys.body.page_count, 800);
      assert.equal(phys.body.duration_minutes, null);

      const audio = await req('POST', '/api/books', {
        title: 'Long Audiobook', format: 'audiobook', duration_minutes: 1200,
      });
      // page_count is now allowed on audiobooks (print-equivalent size
      // for cross-format stats); when omitted it stays null.
      assert.equal(audio.body.page_count, null);
      assert.equal(audio.body.duration_minutes, 1200);
    });

    it('defaults language to English when omitted', async () => {
      const { body } = await req('POST', '/api/books', { title: 'No Lang' });
      assert.equal(body.language, 'English');
    });

    it('normalizes ISBN-10 by stripping hyphens', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Hyphen ISBN', isbn_10: '0-19-285397-9' });
      assert.equal(body.isbn_10, '0192853979');
    });

    it('normalizes ISBN-13 by stripping hyphens', async () => {
      const { body } = await req('POST', '/api/books', { title: 'Hyphen ISBN13', isbn_13: '978-0-7432-7356-5' });
      assert.equal(body.isbn_13, '9780743273565');
    });

    it('normalizes ASIN to uppercase', async () => {
      const { body } = await req('POST', '/api/books', { title: 'ASIN Book', asin: 'b01n4p45mo' });
      assert.equal(body.asin, 'B01N4P45MO');
    });
  });

  describe('joined field sync', () => {
    it('replaces authors on PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Changing Authors', authors: ['Old Author'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Changing Authors', authors: ['New Author A', 'New Author B'],
      });
      assert.equal(body.authors.length, 2);
      assert.ok(body.authors.every(a => ['New Author A', 'New Author B'].includes(a.name)));
      assert.ok(body.authors.every(a => a.name !== 'Old Author'));
    });

    it('preserves author position order', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Co-authored', authors: ['Alice', 'Bob', 'Carol'],
      });
      assert.deepEqual(body.authors.map(a => a.name), ['Alice', 'Bob', 'Carol']);
    });

    it('preserves narrator position order', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Multi-narrator', narrators: ['Alpha Voice', 'Bravo Voice', 'Charlie Voice'],
      });
      assert.deepEqual(body.narrators.map(n => n.name), ['Alpha Voice', 'Bravo Voice', 'Charlie Voice']);
    });

    it('preserves translator position order', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Multi-translator', translators: ['Trans Alpha', 'Trans Bravo', 'Trans Charlie'],
      });
      assert.deepEqual(body.translators.map(t => t.name), ['Trans Alpha', 'Trans Bravo', 'Trans Charlie']);
    });

    it('deduplicates authors case-insensitively within one sync', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dupe Authors', authors: ['Frank Herbert', 'frank herbert'],
      });
      assert.equal(body.authors.length, 1);
      assert.equal(body.authors[0].name, 'Frank Herbert');
    });

    it('deduplicates translators case-insensitively within one sync', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dupe Translators', translators: ['Constance Garnett', 'constance garnett'],
      });
      assert.equal(body.translators.length, 1);
      assert.equal(body.translators[0].name, 'Constance Garnett');
    });

    it('deduplicates narrators case-insensitively within one sync', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Dupe Narrators', narrators: ['Toby Longworth', 'toby longworth'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'Toby Longworth');
    });

    it('reuses existing author row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Book One', authors: ['Shared Author'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Book Two', authors: ['Shared Author'],
      });
      assert.equal(b1.authors[0].id, b2.authors[0].id);
    });

    it('reuses existing narrator row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Narr Reuse A', narrators: ['Shared Narrator'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Narr Reuse B', narrators: ['Shared Narrator'],
      });
      assert.equal(b1.narrators[0].id, b2.narrators[0].id);
    });

    it('reuses existing translator row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Trans Reuse A', translators: ['Shared Translator'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Trans Reuse B', translators: ['Shared Translator'],
      });
      assert.equal(b1.translators[0].id, b2.translators[0].id);
    });

    it('leaves authors unchanged when key omitted from PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Stable Authors', authors: ['Kept Author'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Stable Authors',
      });
      assert.equal(body.authors.length, 1);
      assert.equal(body.authors[0].name, 'Kept Author');
    });

    it('leaves translators unchanged when key omitted from PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Stable Translators',
        authors: ['Some Author'],
        translators: ['Kept Translator'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Stable Translators',
        authors: ['Some Author'],
      });
      assert.equal(body.translators.length, 1);
      assert.equal(body.translators[0].name, 'Kept Translator');
    });

    it('replaces narrators on PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Narrator Test', narrators: ['Old Voice'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Narrator Test', narrators: ['New Voice'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'New Voice');
    });

    it('replaces translators on PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Translated Book',
        translators: ['Old Translator'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Translated Book',
        translators: ['New Translator A', 'New Translator B'],
      });
      assert.equal(body.translators.length, 2);
      assert.ok(body.translators.every(t => ['New Translator A', 'New Translator B'].includes(t.name)));
      assert.ok(body.translators.every(t => t.name !== 'Old Translator'));
    });

    it('leaves narrators unchanged when key omitted from PUT', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Stable Narrators',
        authors: ['Some Author'],
        narrators: ['Kept Voice'],
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Stable Narrators',
        authors: ['Some Author'],
      });
      assert.equal(body.narrators.length, 1);
      assert.equal(body.narrators[0].name, 'Kept Voice');
    });

    it('deduplicates tags case-insensitively', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Tag Dedup', tags: ['sci-fi', 'Sci-Fi', 'SCI-FI'],
      });
      assert.equal(body.tags.length, 1);
    });

    it('reuses existing tag row when name matches', async () => {
      const { body: b1 } = await req('POST', '/api/books', {
        title: 'Tag Reuse A', tags: ['shared-tag'],
      });
      const { body: b2 } = await req('POST', '/api/books', {
        title: 'Tag Reuse B', tags: ['shared-tag'],
      });
      assert.equal(b1.tags[0].id, b2.tags[0].id);
    });
  });

  describe('read_count on finish transition', () => {
    it('increments read_count when status transitions to finished', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Will Finish', status: 'reading',
      });
      assert.equal(created.read_count, 0);
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Will Finish', status: 'finished',
      });
      assert.equal(body.read_count, 1);
    });

    it('does not increment read_count when already finished', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Already Done', status: 'finished',
      });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Already Done', status: 'finished',
      });
      assert.equal(body.read_count, created.read_count);
    });

    it('accepts explicit read_count override', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Re-read' });
      const { body } = await req('PUT', `/api/books/${created.id}`, {
        title: 'Re-read', read_count: 5,
      });
      assert.equal(body.read_count, 5);
    });

    it('auto-INSERTs a reads row on finish transition', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Auto-Reads Book', status: 'reading',
      });
      const { body: before } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(before.length, 0);
      await req('PUT', `/api/books/${created.id}`, {
        title: 'Auto-Reads Book', status: 'finished',
        date_started: '2024-08-01', date_finished: '2024-08-15',
      });
      const { body: after } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(after.length, 1);
      assert.equal(after[0].date_started, '2024-08-01');
      assert.equal(after[0].date_finished, '2024-08-15');
    });

    it('manual read_count bump on already-finished book leaves reads untouched', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Re-read Backfill', status: 'reading',
      });
      // First transition to finished — should add one reads row.
      await req('PUT', `/api/books/${created.id}`, {
        title: 'Re-read Backfill', status: 'finished', date_finished: '2024-09-01',
      });
      const { body: afterFinish } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(afterFinish.length, 1);
      // Now bump read_count to 5 (still finished — no transition). Manual override
      // path: should NOT auto-insert four more rows.
      await req('PUT', `/api/books/${created.id}`, {
        title: 'Re-read Backfill', status: 'finished', read_count: 5,
      });
      const { body: afterBump } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(afterBump.length, 1, 'manual read_count override must not expand into reads rows');
    });

    it('does not auto-INSERT when status is unchanged (e.g. patching review)', async () => {
      const { body: created } = await req('POST', '/api/books', {
        title: 'Re-edit Finished', status: 'reading',
      });
      await req('PUT', `/api/books/${created.id}`, {
        title: 'Re-edit Finished', status: 'finished',
      });
      const { body: afterFinish } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(afterFinish.length, 1);
      // Edit unrelated field; status stays 'finished'.
      await req('PUT', `/api/books/${created.id}`, {
        title: 'Re-edit Finished', status: 'finished', review: 'thoughts',
      });
      const { body: afterEdit } = await req('GET', `/api/books/${created.id}/reads`);
      assert.equal(afterEdit.length, 1);
    });
  });

  describe('PATCH: reading_log and extras', () => {
    let bookId;

    before(async () => {
      const { body } = await req('POST', '/api/books', { title: 'Log Test Book' });
      bookId = body.id;
    });

    it('logs pages_read when current_page increases', async () => {
      await req('PATCH', `/api/books/${bookId}`, { current_page: 50 });
      const { body: log } = await req('GET', `/api/books/${bookId}/log`);
      assert.ok(log.length > 0);
      const entry = log.find(e => e.pages_read >= 50);
      assert.ok(entry, 'expected a log entry with 50 pages');
    });

    it('sort=last_logged places books with reading_log entries above books without', async () => {
      // Stem-scoped fixtures: a logged book gets a PATCH that creates a
      // reading_log row; a never-logged book is just created. Under
      // sort=last_logged the logged book should sort first because the
      // MAX(date) subquery returns today's date for it vs. the empty-string
      // fallback for the never-logged one.
      const stem = 'lastlog-' + Math.random().toString(36).slice(2, 6);
      const { body: never }  = await req('POST', '/api/books', { title: `${stem} never`,  page_count: 100 });
      const { body: logged } = await req('POST', '/api/books', { title: `${stem} logged`, page_count: 100 });
      await req('PATCH', `/api/books/${logged.id}`, { current_page: 30 });
      const { body } = await req('GET', `/api/books?q=${encodeURIComponent(stem)}&sort=last_logged&limit=50`);
      const ids = body.books.map(b => b.id);
      const idxLogged = ids.indexOf(logged.id);
      const idxNever  = ids.indexOf(never.id);
      assert.ok(idxLogged >= 0 && idxNever >= 0);
      assert.ok(idxLogged < idxNever, 'logged book should sort before never-logged book');
    });

    it('does not log when current_page does not increase', async () => {
      const { body: before } = await req('GET', `/api/books/${bookId}/log`);
      await req('PATCH', `/api/books/${bookId}`, { current_page: 10 });
      const { body: after } = await req('GET', `/api/books/${bookId}/log`);
      assert.equal(after.length, before.length);
    });

    it('logs minutes_read when current_minutes increases', async () => {
      const { body: audioId } = await req('POST', '/api/books', { title: 'Audio Log' });
      await req('PATCH', `/api/books/${audioId.id}`, { current_minutes: 60 });
      const { body: log } = await req('GET', `/api/books/${audioId.id}/log`);
      assert.ok(log.length > 0);
      assert.ok(log[0].minutes_read >= 60);
    });

    it('patches loved flag', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Loveable' });
      const { body } = await req('PATCH', `/api/books/${b.id}`, { loved: true });
      assert.equal(body.loved, 1);
      const { body: unlovedBody } = await req('PATCH', `/api/books/${b.id}`, { loved: false });
      assert.equal(unlovedBody.loved, 0);
    });

    it('patches fiction flag', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Unknown Genre' });
      assert.equal(b.fiction, null);
      const { body } = await req('PATCH', `/api/books/${b.id}`, { fiction: true });
      assert.equal(body.fiction, 1);
    });

    it('patches acquisition_source', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Source Test' });
      const { body } = await req('PATCH', `/api/books/${b.id}`, { acquisition_source: 'Library' });
      assert.equal(body.acquisition_source, 'Library');
    });
  });

  describe('shelf assignment rules on books', () => {
    let shelfId;
    let roomId;
    let unitId;
    let buildingId;

    before(async () => {
      const { body: b } = await req('POST', '/api/shelf/buildings', { name: 'Rule Test Building' });
      buildingId = b.id;
      const { body: r } = await req('POST', '/api/shelf/rooms', { building_id: buildingId, name: 'Rule Room' });
      roomId = r.id;
      const { body: u } = await req('POST', '/api/shelf/units', { room_id: roomId, name: 'Rule Unit' });
      unitId = u.id;
      const { body: s } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: '1' });
      shelfId = s.id;
    });

    it('shelf_id set: building_id, room_id, unit_id stored as null', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Shelved', owned: true, shelf_id: shelfId, building_id: buildingId, room_id: roomId, unit_id: unitId,
      });
      assert.equal(body.shelf_id, shelfId);
      assert.equal(body.building_id, null);
      assert.equal(body.room_id, null);
      assert.equal(body.unit_id, null);
    });

    it('unit_id wins over room_id when both present (unit is more specific)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Unit Beats Room', owned: true, room_id: roomId, unit_id: unitId,
      });
      assert.equal(body.unit_id, unitId);
      assert.equal(body.room_id, null);
      assert.equal(body.shelf_id, null);
      assert.equal(body.building_id, null);
    });

    it('room_id only: unit_id and building_id stored as null', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Room Only', owned: true, room_id: roomId, building_id: buildingId,
      });
      assert.equal(body.room_id, roomId);
      assert.equal(body.unit_id, null);
      assert.equal(body.shelf_id, null);
      assert.equal(body.building_id, null);
    });

    it('format gates which physical/audio fields persist on POST', async () => {
      // Mirrors CoreFields.jsx — the form clears these on format
      // change; the API now scrubs them too. Cases:
      //   - audiobook: binding/condition → null; page_count + duration kept
      //     (page_count is the print-equivalent size for cross-format stats).
      //   - ebook:     binding/condition/duration → null; page_count kept.
      //   - physical:  duration → null; the rest kept.
      const audio = await req('POST', '/api/books', {
        title: 'Audio Mix', format: 'audiobook',
        binding: 'paperback', condition: 'fine',
        page_count: 320, duration_minutes: 600,
      });
      assert.equal(audio.body.binding, null);
      assert.equal(audio.body.condition, null);
      assert.equal(audio.body.page_count, 320);
      assert.equal(audio.body.duration_minutes, 600);

      const ebook = await req('POST', '/api/books', {
        title: 'Ebook Mix', format: 'ebook',
        binding: 'hardcover', condition: 'new',
        page_count: 250, duration_minutes: 500,
      });
      assert.equal(ebook.body.binding, null);
      assert.equal(ebook.body.condition, null);
      assert.equal(ebook.body.page_count, 250);
      assert.equal(ebook.body.duration_minutes, null);

      const physical = await req('POST', '/api/books', {
        title: 'Physical Mix', format: 'physical', owned: true,
        binding: 'hardcover', condition: 'new',
        page_count: 400, duration_minutes: 600,
      });
      assert.equal(physical.body.binding, 'hardcover');
      assert.equal(physical.body.condition, 'new');
      assert.equal(physical.body.page_count, 400);
      assert.equal(physical.body.duration_minutes, null);
    });

    it('PUT applies the same format-gated scrub as POST', async () => {
      // Editing a physical book into an audiobook (rare but real) must clear
      // shelf_id/unit_id/room_id/building_id/binding/condition while
      // page_count (cross-format size) and duration_minutes persist.
      const { body: created } = await req('POST', '/api/books', {
        title: 'Was Physical', format: 'physical', owned: true,
        binding: 'hardcover', condition: 'fine',
        page_count: 400, shelf_id: shelfId,
      });
      // Sanity: POST stored the physical-only fields.
      assert.equal(created.binding, 'hardcover');
      assert.equal(created.shelf_id, shelfId);

      // Round-trip the GET shape but flip format and add duration; existing
      // shelf_id stays in the payload, mirroring what a careless edit-form
      // round-trip would send.
      const { body: updated } = await req('PUT', `/api/books/${created.id}`, {
        ...created,
        format: 'audiobook',
        duration_minutes: 700,
        tags: [],
      });
      assert.equal(updated.format, 'audiobook');
      assert.equal(updated.duration_minutes, 700);
      assert.equal(updated.binding, null);
      assert.equal(updated.condition, null);
      // page_count survives the format flip — same print-equivalent size.
      assert.equal(updated.page_count, 400);
      assert.equal(updated.shelf_id, null);
      assert.equal(updated.unit_id, null);
      assert.equal(updated.room_id, null);
      assert.equal(updated.building_id, null);
    });

    it('non-physical books cannot have shelf locations', async () => {
      // Shelves only hold physical books; the read path filters
      // `format = 'physical' OR NULL`. The write path now mirrors that, so a
      // direct API call to put an audiobook on a shelf is silently scrubbed.
      const audio = await req('POST', '/api/books', {
        title: 'Audio Shelved', format: 'audiobook', shelf_id: shelfId,
      });
      assert.equal(audio.body.shelf_id, null);
      assert.equal(audio.body.unit_id, null);
      assert.equal(audio.body.room_id, null);
      assert.equal(audio.body.building_id, null);

      const ebook = await req('POST', '/api/books', {
        title: 'Ebook Roomed', format: 'ebook', room_id: roomId,
      });
      assert.equal(ebook.body.shelf_id, null);
      assert.equal(ebook.body.unit_id, null);
      assert.equal(ebook.body.room_id, null);
      assert.equal(ebook.body.building_id, null);
    });

    it('unit_id only (no shelf_id, no room_id): unit_id stored', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Unit Only', owned: true, unit_id: unitId,
      });
      assert.equal(body.unit_id, unitId);
      assert.equal(body.shelf_id, null);
      assert.equal(body.room_id, null);
      assert.equal(body.building_id, null);
    });
  });

  // Path-traversal hardening for cover_path. The stored value must always be a
  // bare safe filename, otherwise deleteLocalCover() (called on cover replace
  // and book delete) could unlink files outside uploads/.
  describe('cover_path path-traversal protection', () => {
    it('rejects /uploads/.. escape attempts (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Sneaky', cover_path: '/uploads/../../etc/passwd',
      });
      assert.equal(body.cover_path, null);
    });

    it('rejects cover_path missing the /uploads/ prefix (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Bare path', cover_path: '../../etc/passwd',
      });
      assert.equal(body.cover_path, null);
    });

    it('rejects cover_path with a subdirectory under /uploads/ (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Subdir', cover_path: '/uploads/sub/dir/file.webp',
      });
      assert.equal(body.cover_path, null);
    });

    it('accepts a normal /uploads/<filename> and round-trips', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Legit', cover_path: '/uploads/1234567890-abcdef.webp',
      });
      assert.equal(body.cover_path, '/uploads/1234567890-abcdef.webp');
    });

    it('rejects bare "." and ".." filenames (stores null)', async () => {
      // Defence in depth: even though fs.unlink('.') / fs.unlink('..') would
      // EISDIR rather than delete anything, accepting these contradicts the
      // intent of the validator and is easy to bar at the regex level.
      for (const bad of ['/uploads/.', '/uploads/..', '/uploads/.webp', '/uploads/..webp']) {
        const { body } = await req('POST', '/api/books', { title: 'Sneaky', cover_path: bad });
        assert.equal(body.cover_path, null, `expected null for ${bad}`);
      }
    });

    it('accepts the supported image extensions (webp, jpg, jpeg, png, gif)', async () => {
      // After dropping the sharp/webp pipeline, legacy and modern formats
      // round-trip through the API as long as the filename shape matches.
      for (const ext of ['webp', 'jpg', 'jpeg', 'png', 'gif']) {
        const url = `/uploads/1234567890-abcdef.${ext}`;
        const { body } = await req('POST', '/api/books', {
          title: `ext ${ext}`, cover_path: url,
        });
        assert.equal(body.cover_path, url, `${ext} should round-trip`);
      }
    });

    it('rejects unsupported image extensions (stores null)', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'Wrong ext', cover_path: '/uploads/1234567890-abcdef.bmp',
      });
      assert.equal(body.cover_path, null);
    });

    it('PUT preserves existing cover when payload sends a malformed cover_path', async () => {
      // Defensive guard: if the user sends a non-empty cover_path that fails
      // toFilename (e.g. legacy format outside the regex, or just typo'd),
      // PUT must NOT silently destroy the existing cover. Distinguishes
      // "explicit clear" (null/empty) from "malformed input".
      const validCover = '/uploads/1234567890-abcdef.jpg';
      const { body: created } = await req('POST', '/api/books', {
        title: 'Defensive cover test', cover_path: validCover,
      });
      assert.equal(created.cover_path, validCover, 'fixture should have a valid cover');

      // Malformed PUT (bmp not in accepted list)
      const { body: malformed } = await req('PUT', `/api/books/${created.id}`, {
        ...created, cover_path: '/uploads/totally-bad.bmp', tags: [],
      });
      assert.equal(malformed.cover_path, validCover,
        'malformed cover_path on PUT must preserve existing, not destroy it');

      // Explicit clear (null) should still actually clear
      const { body: cleared } = await req('PUT', `/api/books/${created.id}`, {
        ...created, cover_path: null, tags: [],
      });
      assert.equal(cleared.cover_path, null, 'null cover_path on PUT should clear');
    });
  });

  describe('archived', () => {
    it('persists archived flag through POST, PUT, and PATCH', async () => {
      const { body: created } = await req('POST', '/api/books', { title: 'Archive POST', archived: true });
      assert.equal(created.archived, 1);

      const { body: putUnarchive } = await req('PUT', `/api/books/${created.id}`, {
        ...created, archived: false, tags: [],
      });
      assert.equal(putUnarchive.archived, 0);

      const { body: patched } = await req('PATCH', `/api/books/${created.id}`, { archived: true });
      assert.equal(patched.archived, 1);
    });

    it('archiving auto-clears on_readlist (forward-looking state)', async () => {
      // The readlist is a forward-looking queue, so archiving (a forward-looking
      // hide-from-active decision) implies removing from it. Loved and shelf
      // assignment are passive metadata and stay intact — see book-model.md.
      const { body: created } = await req('POST', '/api/books', {
        title: 'Archive readlist-clear', on_readlist: true, loved: true,
      });
      assert.equal(created.on_readlist, 1);
      assert.notEqual(created.readlist_position, null);
      assert.equal(created.loved, 1);

      const { body: archived } = await req('PATCH', `/api/books/${created.id}`, { archived: true });
      assert.equal(archived.archived, 1);
      assert.equal(archived.on_readlist, 0);
      assert.equal(archived.readlist_position, null);
      assert.equal(archived.loved, 1, 'loved is passive metadata and survives archiving');
    });

    it('list endpoint excludes archived by default', async () => {
      const { body: active }   = await req('POST', '/api/books', { title: 'Active list-default' });
      const { body: archived } = await req('POST', '/api/books', { title: 'Archived list-default', archived: true });

      const { body: list } = await req('GET', '/api/books?limit=200');
      const ids = list.books.map(b => b.id);
      assert.ok(ids.includes(active.id),    'active book should appear');
      assert.ok(!ids.includes(archived.id), 'archived book should NOT appear by default');
    });

    it('tab=archived returns archived-only', async () => {
      const { body: active }   = await req('POST', '/api/books', { title: 'Active tab-archived' });
      const { body: archived } = await req('POST', '/api/books', { title: 'Archived tab-archived', archived: true });

      const { body: list } = await req('GET', '/api/books?tab=archived&limit=200');
      const ids = list.books.map(b => b.id);
      assert.ok(ids.includes(archived.id), 'archived book should appear on Archived tab');
      assert.ok(!ids.includes(active.id),  'active book should NOT appear on Archived tab');
    });

    it('archived=any includes both active and archived', async () => {
      const { body: active }   = await req('POST', '/api/books', { title: 'Active any-mode' });
      const { body: archived } = await req('POST', '/api/books', { title: 'Archived any-mode', archived: true });

      const { body: list } = await req('GET', '/api/books?archived=any&limit=200');
      const ids = list.books.map(b => b.id);
      assert.ok(ids.includes(active.id));
      assert.ok(ids.includes(archived.id));
    });

    it('free-text search (q) surfaces archived results so users can find them to un-archive', async () => {
      // The Archived tab is the dedicated browse surface, but the search bar
      // must still find archived items — otherwise an archived book is
      // unfindable except by clicking through to the Archived tab and
      // searching there. This mirrors the design rule: history-style
      // surfaces include archived; the search affordance is treated as
      // history-style for findability.
      const { body: archived } = await req('POST', '/api/books', {
        title: 'ZZUniqueArchivedSentinel', archived: true,
      });
      const { body: list } = await req('GET', '/api/books?q=ZZUniqueArchivedSentinel');
      const ids = list.books.map(b => b.id);
      assert.ok(ids.includes(archived.id), 'archived book should appear in q-bearing search');
    });

    it('archived=0 forces exclusion even with a search query', async () => {
      // Escape hatch for callers that want strictly-active search (e.g. a
      // future "search active library only" toggle). q-bearing default of
      // include-archived is overridable.
      await req('POST', '/api/books', { title: 'ZZForceExclude', archived: true });
      const { body: list } = await req('GET', '/api/books?q=ZZForceExclude&archived=0');
      assert.equal(list.books.length, 0);
    });

    it('GET /api/books/counts excludes archived from active counts and surfaces archived count', async () => {
      // Tests share an in-memory DB so we measure deltas around fresh inserts
      // rather than expecting absolute counts. The point of this test is the
      // gate logic: an archived book bumps `archived` but NOT the per-status
      // or owned/total counters.
      const before = (await req('GET', '/api/books/counts')).body;

      const { body: arch1 } = await req('POST', '/api/books', {
        title: 'CountTest Arch finished', owned: true, status: 'finished', archived: true,
      });
      const { body: arch2 } = await req('POST', '/api/books', {
        title: 'CountTest Arch reading',  owned: true, status: 'reading',  archived: true,
      });
      const { body: act1 } = await req('POST', '/api/books', {
        title: 'CountTest Active reading', owned: true, status: 'reading',
      });

      const after = (await req('GET', '/api/books/counts')).body;
      assert.equal(after.archived - before.archived, 2, 'archived counter += 2 archived inserts');
      assert.equal(after.reading  - before.reading,  1, 'reading counter += 1 active reading (archived ones excluded)');
      assert.equal(after.finished - before.finished, 0, 'finished counter += 0 (the only finished insert was archived)');
      assert.equal(after.owned    - before.owned,    1, 'owned counter += 1 (archived owned books excluded)');
      assert.equal(after.total    - before.total,    1, 'total reflects active-library size (archived excluded)');

      // Cleanup so other tests don't see these fixtures.
      await req('DELETE', `/api/books/${arch1.id}`);
      await req('DELETE', `/api/books/${arch2.id}`);
      await req('DELETE', `/api/books/${act1.id}`);
    });
  });

  describe('cross-edition links (work_id)', () => {
    // Two books that share a non-NULL work_id are alternate editions of the
    // same underlying work — different format / translation / printing. The
    // relationship is set-based via the shared id, so symmetry and
    // transitivity fall out for free, and any member's `editions` array
    // lists every other member.

    async function mkBook(title) {
      const { body } = await req('POST', '/api/books', { title });
      return body;
    }

    it('linking two unlinked books mints a shared work_id and surfaces siblings', async () => {
      const a = await mkBook('Edition Test A1');
      const b = await mkBook('Edition Test B1');
      const { status, body } = await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      assert.equal(status, 200);
      assert.ok(body.work_id != null, 'expected work_id to be set on returned book');
      assert.equal(body.editions.length, 1);
      assert.equal(body.editions[0].id, b.id);

      // Symmetry: B's detail page sees A.
      const { body: bRefetched } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bRefetched.work_id, body.work_id);
      assert.equal(bRefetched.editions.length, 1);
      assert.equal(bRefetched.editions[0].id, a.id);
    });

    it('linking a third book joins the existing group transitively', async () => {
      const a = await mkBook('Edition Test A2');
      const b = await mkBook('Edition Test B2');
      const c = await mkBook('Edition Test C2');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      await req('POST', `/api/books/${b.id}/work-link`, { other_id: c.id });

      const { body: aGet } = await req('GET', `/api/books/${a.id}`);
      const editionIds = aGet.editions.map(e => e.id).sort((x, y) => x - y);
      assert.deepEqual(editionIds, [b.id, c.id].sort((x, y) => x - y));
    });

    it('linking two existing groups merges them into the lower work_id', async () => {
      const a = await mkBook('Edition Test A3');
      const b = await mkBook('Edition Test B3');
      const c = await mkBook('Edition Test C3');
      const d = await mkBook('Edition Test D3');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      await req('POST', `/api/books/${c.id}/work-link`, { other_id: d.id });
      const { body: aBefore } = await req('GET', `/api/books/${a.id}`);
      const { body: cBefore } = await req('GET', `/api/books/${c.id}`);
      const lower = Math.min(aBefore.work_id, cBefore.work_id);

      await req('POST', `/api/books/${a.id}/work-link`, { other_id: c.id });
      for (const id of [a.id, b.id, c.id, d.id]) {
        const { body } = await req('GET', `/api/books/${id}`);
        assert.equal(body.work_id, lower, `book ${id} should land on the lower work_id`);
        assert.equal(body.editions.length, 3);
      }
    });

    it('unlinking removes a book from the group and dissolves singletons', async () => {
      const a = await mkBook('Edition Test A4');
      const b = await mkBook('Edition Test B4');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });

      const { status, body } = await req('DELETE', `/api/books/${a.id}/work-link`);
      assert.equal(status, 200);
      assert.equal(body.work_id, null);
      assert.equal(body.editions.length, 0);

      // The lone survivor B also drops its work_id — a stamped id on a
      // single book is a phantom group and shouldn't leak through.
      const { body: bGet } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bGet.work_id, null);
      assert.equal(bGet.editions.length, 0);
    });

    it('unlinking from a group of three leaves the other two linked', async () => {
      const a = await mkBook('Edition Test A5');
      const b = await mkBook('Edition Test B5');
      const c = await mkBook('Edition Test C5');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: c.id });

      await req('DELETE', `/api/books/${a.id}/work-link`);
      const { body: bGet } = await req('GET', `/api/books/${b.id}`);
      const { body: cGet } = await req('GET', `/api/books/${c.id}`);
      assert.ok(bGet.work_id != null, 'B should still be in the group');
      assert.equal(bGet.work_id, cGet.work_id);
      assert.equal(bGet.editions.length, 1);
      assert.equal(bGet.editions[0].id, c.id);
    });

    it('archived siblings hide from a non-archived book\'s editions list, but the archived book itself still sees them', async () => {
      // Mirrors the Library default-view rule: archived rows surface only on
      // tab=archived / when the user has explicitly opted into archive
      // territory. The opt-in case here is "you're already on an archived
      // book's detail page" — at that point siblings (archived or not) are
      // all visible.
      const a = await mkBook('Edition Archive Visible');
      const b = await mkBook('Edition Archive Hidden');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });

      // Both visible before any archive.
      const { body: aBefore } = await req('GET', `/api/books/${a.id}`);
      assert.equal(aBefore.editions.length, 1);

      // Archive B. From A's (non-archived) detail page, B should disappear.
      await req('PATCH', `/api/books/${b.id}`, { archived: true });
      const { body: aAfter } = await req('GET', `/api/books/${a.id}`);
      assert.equal(aAfter.editions.length, 0,
        'expected archived sibling to be hidden from non-archived book\'s editions list');

      // From B's own (archived) detail page, A is still visible — opt-in.
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bAfter.editions.length, 1);
      assert.equal(bAfter.editions[0].id, a.id);

      // Un-archive B and the symmetry returns.
      await req('PATCH', `/api/books/${b.id}`, { archived: false });
      const { body: aRestored } = await req('GET', `/api/books/${a.id}`);
      assert.equal(aRestored.editions.length, 1);
    });

    it('rejects linking a book to itself', async () => {
      const a = await mkBook('Edition Test Self');
      const { status, body } = await req('POST', `/api/books/${a.id}/work-link`, { other_id: a.id });
      assert.equal(status, 400);
      assert.match(body.error, /itself/i);
    });

    it('returns 404 when either book does not exist', async () => {
      const a = await mkBook('Edition Test Missing');
      const { status } = await req('POST', `/api/books/${a.id}/work-link`, { other_id: 999999 });
      assert.equal(status, 404);
    });

    it('re-linking books already in the same group is a no-op', async () => {
      const a = await mkBook('Edition Test Idem A');
      const b = await mkBook('Edition Test Idem B');
      const { body: first } = await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      const { status, body: second } = await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      assert.equal(status, 200);
      assert.equal(second.work_id, first.work_id);
    });

    it('unlinking a book that is not in any group is a no-op', async () => {
      const a = await mkBook('Edition Test Unlinked');
      const { status, body } = await req('DELETE', `/api/books/${a.id}/work-link`);
      assert.equal(status, 200);
      assert.equal(body.work_id, null);
    });

    it('rating changes do NOT propagate to linked editions', async () => {
      // As of v1.49.0, linked editions own their own rating, review, and
      // read_count. Rating is a property of the edition (translation
      // quality, narrator, the specific reading experience) — Emily
      // Wilson's Odyssey can be 2★ while another translation is 5★ on
      // the same work. Each edition stays where the user puts it.
      const a = await mkBook('No-Propagate Rating A');
      const b = await mkBook('No-Propagate Rating B');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      const { body: aLinked } = await req('GET', `/api/books/${a.id}`);
      await req('PUT', `/api/books/${a.id}`, { ...aLinked, rating: 4.5, tags: [] });
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bAfter.rating, null, 'sibling rating untouched');
    });

    it('review changes do NOT propagate to linked editions', async () => {
      const a = await mkBook('No-Propagate Review A');
      const b = await mkBook('No-Propagate Review B');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      const { body: aLinked } = await req('GET', `/api/books/${a.id}`);
      await req('PUT', `/api/books/${a.id}`, { ...aLinked, review: 'Excellent.', tags: [] });
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bAfter.review, null, 'sibling review untouched');
    });

    it('finishing a linked edition does NOT bump siblings\' read_count', async () => {
      const a = await mkBook('No-Propagate Read A');
      const b = await mkBook('No-Propagate Read B');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      const { body: aLinked } = await req('GET', `/api/books/${a.id}`);
      await req('PUT', `/api/books/${a.id}`, { ...aLinked, status: 'finished', date_finished: '2025-01-01', tags: [] });
      const { body: aAfter } = await req('GET', `/api/books/${a.id}`);
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(aAfter.read_count, 1, 'finished edition counts its own read');
      assert.equal(bAfter.read_count, 0, 'sibling read_count untouched');
    });

    it('editions array surfaces sibling rating and read_count', async () => {
      // EditionsSection renders these inline so the user can see at a
      // glance "I've finished the audiobook 2× at 5★" without having to
      // click into each sibling.
      const a = await mkBook('Surface A');
      const b = await mkBook('Surface B');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      // Independently set state on B.
      const { body: bLinked } = await req('GET', `/api/books/${b.id}`);
      await req('PUT', `/api/books/${b.id}`, {
        ...bLinked, status: 'finished', date_finished: '2024-08-15', rating: 5, tags: [],
      });
      // A's editions[] entry for B should carry rating + read_count.
      const { body: aAfter } = await req('GET', `/api/books/${a.id}`);
      const sibling = aAfter.editions.find(e => e.id === b.id);
      assert.ok(sibling, 'sibling present in editions array');
      assert.equal(sibling.rating, 5);
      assert.equal(sibling.read_count, 1);
    });

    it('unlinked books sharing title and first-author do not cross-propagate', async () => {
      // Defect from the legacy heuristic: any two books with the same title
      // and first-author name were silently treated as linked editions and
      // shared rating/review writes. This wrongly affected unrelated books
      // (e.g. anthologies under "Various Authors", duplicate placeholder
      // names like "Anonymous"). With work_id gating, no link → no sync.
      const stem = 'unlinked-share-' + Math.random().toString(36).slice(2, 6);
      const { body: a } = await req('POST', '/api/books', { title: stem, authors: ['Shared Name'] });
      const { body: b } = await req('POST', '/api/books', { title: stem, authors: ['Shared Name'] });
      const { body: aFull } = await req('GET', `/api/books/${a.id}`);
      await req('PUT', `/api/books/${a.id}`, { ...aFull, rating: 5, tags: [] });
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bAfter.rating, null, 'unlinked sibling must not receive A’s rating');
    });
  });

  describe('diacritic-insensitive search', () => {
    // The `q` LIKE clauses pass both the stored value and the literal
    // through nrm() so accents and a handful of non-decomposing ligatures
    // (æ → ae, etc.) don't block matches in either direction.

    it('plain-ASCII query matches accented stored title', async () => {
      const stem = 'diac' + Math.random().toString(36).slice(2, 8);
      await req('POST', '/api/books', { title: `Café ${stem} Naïve` });
      const { body } = await req('GET', `/api/books?q=cafe%20${stem}%20naive`);
      assert.equal(body.books.length, 1);
    });

    it('æ ligature folds to ae in both directions', async () => {
      const stem = 'lig' + Math.random().toString(36).slice(2, 8);
      await req('POST', '/api/books', { title: `Thermæ ${stem} Rōmæ` });
      // Plain query against ligature-stored title.
      const { body: plainHit } = await req('GET', `/api/books?q=thermae%20${stem}%20romae`);
      assert.equal(plainHit.books.length, 1);
      // Ligature query against ligature-stored title (sanity).
      const { body: ligHit } = await req('GET', `/api/books?q=therm%C3%A6%20${stem}`);
      assert.equal(ligHit.books.length, 1);
    });

    it('rejects literals that fold to empty so they do not match every book', async () => {
      // A literal that's pure combining diacritics ("´", U+00B4) collapses
      // to '' under nrm. Without the guard in atomSql/qatomSql, the LIKE
      // pattern becomes '%%' and the search returns the entire library.
      // We expect zero matches against a fresh stem, asserting via total.
      await req('POST', '/api/books', { title: 'pure-diacritic-test ' + Math.random().toString(36).slice(2, 8) });
      const { body } = await req('GET', '/api/books?q=%C2%B4');
      assert.equal(body.total, 0);
    });

    it('folds across people surfaces (author / narrator)', async () => {
      const stem = 'people' + Math.random().toString(36).slice(2, 8);
      await req('POST', '/api/books', {
        title: `Untitled ${stem}`,
        authors: [`Renée ${stem}eau`],
        narrators: [`Søren ${stem}sen`],
      });
      const { body: byAuth } = await req('GET', `/api/books?q=renee%20${stem}eau`);
      assert.equal(byAuth.books.length, 1);
      const { body: byNarr } = await req('GET', `/api/books?q=soren%20${stem}sen`);
      assert.equal(byNarr.books.length, 1);
    });
  });

  describe('search qualifiers', () => {
    // `qualifier:value` pins a search atom to a single surface (title /
    // series / tag / author / narrator / translator / publisher) instead
    // of the default match-against-all-six-surfaces behaviour. Composes
    // with AND / OR / NOT and quoted phrases.
    const stem = 'qualifier' + Math.random().toString(36).slice(2, 8);

    let titleHit, authorHit, narratorHit, tagHit, publisherHit;

    before(async () => {
      // Seed: each book has the stem in exactly ONE surface so we can
      // assert qualifier routing rather than substring leakage.
      ({ body: titleHit } = await req('POST', '/api/books', {
        title: `${stem}-by-title`,
      }));
      ({ body: authorHit } = await req('POST', '/api/books', {
        title: 'Authored', authors: [`${stem}-author`],
      }));
      ({ body: narratorHit } = await req('POST', '/api/books', {
        title: 'Narrated', narrators: [`${stem}-narrator`],
      }));
      ({ body: tagHit } = await req('POST', '/api/books', {
        title: 'Tagged', tags: [`${stem}-tag`],
      }));
      ({ body: publisherHit } = await req('POST', '/api/books', {
        title: 'Published', publisher: `${stem} House`,
      }));
    });

    async function search(q) {
      const { body } = await req('GET', `/api/books?q=${encodeURIComponent(q)}&limit=200`);
      return new Set(body.books.map(b => b.id));
    }

    it('bare term matches across all six default surfaces (control)', async () => {
      // Default bare-term surfaces are title/series/tag/author/narrator/
      // translator. Publisher is NOT in the bare-term set — it's reachable
      // only via the explicit `publisher:` qualifier.
      const ids = await search(stem);
      assert.ok(ids.has(titleHit.id));
      assert.ok(ids.has(authorHit.id));
      assert.ok(ids.has(narratorHit.id));
      assert.ok(ids.has(tagHit.id));
      assert.ok(!ids.has(publisherHit.id), 'publisher is opt-in via qualifier');
    });

    it('author:X pins the match to authors only', async () => {
      const ids = await search(`author:${stem}`);
      assert.ok(ids.has(authorHit.id));
      assert.ok(!ids.has(titleHit.id));
      assert.ok(!ids.has(narratorHit.id));
      assert.ok(!ids.has(tagHit.id));
      assert.ok(!ids.has(publisherHit.id));
    });

    it('tag:X pins the match to real tags only', async () => {
      const ids = await search(`tag:${stem}`);
      assert.ok(ids.has(tagHit.id));
      assert.ok(!ids.has(titleHit.id));
      assert.ok(!ids.has(authorHit.id));
    });

    it('title:X pins the match to title', async () => {
      const ids = await search(`title:${stem}`);
      assert.ok(ids.has(titleHit.id));
      assert.ok(!ids.has(authorHit.id));
      assert.ok(!ids.has(tagHit.id));
    });

    it('narrator:X and translator:X pin to their respective joins', async () => {
      const narr = await search(`narrator:${stem}`);
      assert.ok(narr.has(narratorHit.id));
      assert.ok(!narr.has(authorHit.id));

      const trans = await search(`translator:${stem}`);
      assert.equal(trans.size, 0, 'no translators carry the stem');
    });

    it('list:X pins the match to list membership', async () => {
      const { body: list } = await req('POST', '/api/lists', { name: `${stem}-list` });
      await req('POST', `/api/lists/${list.id}/books`, { book_id: titleHit.id });
      const ids = await search(`list:${stem}`);
      assert.ok(ids.has(titleHit.id));
      // A book NOT in the list — the tag-hit — should not appear, even
      // though it carries the stem in its tag surface.
      assert.ok(!ids.has(tagHit.id));
      assert.ok(!ids.has(authorHit.id));
    });

    it('publisher:X pins the match to publisher', async () => {
      const ids = await search(`publisher:${stem}`);
      assert.ok(ids.has(publisherHit.id));
      assert.ok(!ids.has(titleHit.id));
    });

    it('quoted value works after a qualifier', async () => {
      const ids = await search(`publisher:"${stem} House"`);
      assert.ok(ids.has(publisherHit.id));
      // A bare-term search for House would surface non-publisher matches;
      // with the qualifier + phrase, the result is publisher-only.
      assert.ok(!ids.has(titleHit.id));
    });

    it('composes with AND, OR, and NOT', async () => {
      // OR: title-hit AND tag-hit are both retrieved.
      const orIds = await search(`title:${stem} OR tag:${stem}`);
      assert.ok(orIds.has(titleHit.id));
      assert.ok(orIds.has(tagHit.id));
      assert.ok(!orIds.has(authorHit.id));

      // AND (implicit): a book with both an author AND a tag bearing the
      // stem — author-hit doesn't have the tag, tag-hit doesn't have the
      // author, so the AND of qualifiers returns nothing.
      const andIds = await search(`author:${stem} tag:${stem}`);
      assert.equal(andIds.size, 0);

      // NOT: bare match minus tag-only.
      const notIds = await search(`${stem} -tag:${stem}`);
      assert.ok(notIds.has(titleHit.id));
      assert.ok(notIds.has(authorHit.id));
      assert.ok(!notIds.has(tagHit.id));
    });

    it('unknown qualifier prefix falls back to bare-term match', async () => {
      // `weirdqual:foo` isn't in the qualifier set, so the tokenizer treats
      // it as an ordinary term that happens to contain a colon. The
      // stem-only suffix won't match anything, but the test asserts the
      // request doesn't error out.
      const { status } = await req('GET', `/api/books?q=${encodeURIComponent('weirdqual:' + stem)}`);
      assert.equal(status, 200);
    });

    it('qualifier with empty value is dropped silently', async () => {
      // `author:` alone produces no token, so the q reduces to "stem"
      // (bare term across all surfaces).
      const ids = await search(`author: ${stem}`);
      assert.ok(ids.has(titleHit.id));
      assert.ok(ids.has(authorHit.id));
    });

    it('inner colons inside a qualifier value are part of the value', async () => {
      // Series names sometimes contain colons (e.g. "Hugo Award: Best Novel").
      // The value scan must run to the next whitespace/paren/quote rather
      // than splitting at the first inner colon.
      const colonStem = stem + 'colon';
      const { body: hit } = await req('POST', '/api/books', {
        title: 'Inner Colon', series: `${colonStem}:Best`,
      });
      const ids = await search(`series:${colonStem}:Best`);
      assert.ok(ids.has(hit.id));
    });
  });

  describe('year_published_approximate', () => {
    it('saves and returns the flag independently of year_approximate', async () => {
      // Ancient works: published year is approximate, edition year is exact.
      // year_approximate / year_published_approximate are independent so the
      // form can mark each on its own. Placed at end-of-file so this
      // fixture's row doesn't bump prior sort-tests' fixtures past the
      // global GET /api/books limit cap.
      async function req(method, path, body) {
        const res = await fetch(`${url}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body != null ? JSON.stringify(body) : undefined,
        });
        const data = res.status === 204 ? null : await res.json();
        return { status: res.status, body: data };
      }
      const { status, body } = await req('POST', '/api/books', {
        title: 'YPA Letters', year_published: 65, year_edition: 2017,
        year_published_approximate: true, year_approximate: false,
      });
      assert.equal(status, 201);
      assert.equal(body.year_published, 65);
      assert.equal(body.year_edition, 2017);
      assert.equal(body.year_published_approximate, 1);
      assert.equal(body.year_approximate, 0);
    });
  });

  describe('Long / Tome virtual-tag boundary', () => {
    // Long is 500-999 pages, Tome is 1000+. Mutually exclusive — mirrors
    // the Antique/Vintage split. Audio-equivalent thresholds: Long
    // 840-1679 minutes, Tome 1680+.
    it('500-page book gets Long, not Tome', async () => {
      const { body } = await req('POST', '/api/books', { title: 'BoundaryLong', page_count: 500 });
      const names = body.tags.map(t => t.name);
      assert.ok(names.includes('Long'),  'expected Long');
      assert.ok(!names.includes('Tome'), 'did not expect Tome at 500');
    });
    it('999-page book gets Long, not Tome', async () => {
      const { body } = await req('POST', '/api/books', { title: 'BoundaryLongMax', page_count: 999 });
      const names = body.tags.map(t => t.name);
      assert.ok(names.includes('Long'),  'expected Long at 999');
      assert.ok(!names.includes('Tome'), 'did not expect Tome at 999');
    });
    it('1000-page book gets Tome, not Long', async () => {
      const { body } = await req('POST', '/api/books', { title: 'BoundaryTome', page_count: 1000 });
      const names = body.tags.map(t => t.name);
      assert.ok(names.includes('Tome'),  'expected Tome at 1000');
      assert.ok(!names.includes('Long'), 'did not expect Long at 1000');
    });
    it('long audiobook (28h) gets Tome, not Long', async () => {
      const { body } = await req('POST', '/api/books', {
        title: 'BoundaryTomeAudio', format: 'audiobook', duration_minutes: 1680,
      });
      const names = body.tags.map(t => t.name);
      assert.ok(names.includes('Tome'),  'expected Tome at 1680 min');
      assert.ok(!names.includes('Long'), 'did not expect Long at 1680 min');
    });

    it('field=tag filter resolves virtual tags (Tome)', async () => {
      // Regression: /browse/tag/Tome was returning 0 because the
      // field=tag branch JOINed the real tags table only. Virtual tags
      // need the rule's predicate.
      const { body: tome } = await req('POST', '/api/books', {
        title: 'BoundaryTomeBrowse', page_count: 1200,
      });
      const { body: notTome } = await req('POST', '/api/books', {
        title: 'BoundaryNotTome', page_count: 200,
      });
      const { body: results } = await req('GET', '/api/books?field=tag&value=Tome&limit=500');
      const ids = new Set(results.books.map(b => b.id));
      assert.ok(ids.has(tome.id),     'Tome book should appear');
      assert.ok(!ids.has(notTome.id), 'short book should not appear');
    });
  });
});
