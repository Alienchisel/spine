import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTestServer } from './helpers.js';

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
      // Editing a non-fiction book to fiction must drop source_type even if
      // the form payload still carries the old value (round-trip pattern).
      const { body: created } = await req('POST', '/api/books', {
        title: 'History', fiction: false, source_type: 'primary',
      });
      assert.equal(created.source_type, 'primary');

      const { body: madeFiction } = await req('PUT', `/api/books/${created.id}`, {
        ...created, fiction: true, source_type: 'primary', tags: [],
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

    it('source_type is dropped on fiction or unset-fiction books', async () => {
      // Mirrors CoreFields.jsx:64 — the form only keeps source_type when
      // fiction === false. The backend now enforces the same gate, so
      // primary/secondary classification stays semantically clean on facets.
      const fictionBook = await req('POST', '/api/books', {
        title: 'Iliad', fiction: true, source_type: 'primary',
      });
      assert.equal(fictionBook.body.fiction, 1);
      assert.equal(fictionBook.body.source_type, null);

      const unsetBook = await req('POST', '/api/books', {
        title: 'Mystery Genre', source_type: 'primary',
      });
      assert.equal(unsetBook.body.fiction, null);
      assert.equal(unsetBook.body.source_type, null);
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
      const { body: rd } = await req('POST', '/api/books', { title: `${stem} reading`, status: 'reading' });
      const { body: pd } = await req('POST', '/api/books', { title: `${stem} paused`,  status: 'paused' });
      const { body: fd } = await req('POST', '/api/books', { title: `${stem} finished`, status: 'finished' });
      const { body: ud } = await req('POST', '/api/books', { title: `${stem} unread`,  status: 'unread' });

      const enc = encodeURIComponent;
      const collect = async (q) => {
        const { body } = await req('GET', `/api/books?q=${enc(stem)}&${q}&limit=50`);
        return new Set(body.books.map(b => b.id));
      };

      // Single status: just that status.
      const oneOnly = await collect('statuses=reading');
      assert.ok(oneOnly.has(rd.id));
      assert.ok(!oneOnly.has(pd.id));
      assert.ok(!oneOnly.has(fd.id));
      assert.ok(!oneOnly.has(ud.id));

      // Multi: in-progress shortcut (reading OR paused).
      const inProgress = await collect('statuses=reading&statuses=paused');
      assert.ok(inProgress.has(rd.id));
      assert.ok(inProgress.has(pd.id));
      assert.ok(!inProgress.has(fd.id));
      assert.ok(!inProgress.has(ud.id));

      // No statuses param → no status restriction (all four match the stem).
      const all = await collect('');
      assert.ok(all.has(rd.id) && all.has(pd.id) && all.has(fd.id) && all.has(ud.id));
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

    it('GET /api/books/counts increments reading, paused, finished counters', async () => {
      // Mirrors the unread-default test above for the remaining statuses, which
      // back the tab badges on Library and would silently break if their SUM
      // expression in repository.js were typo'd.
      const cases = [
        { status: 'reading' },
        { status: 'paused' },
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
      // The counts row also exposes ownership totals (repository.js:46-47).
      // previously_owned is forced to 0 when owned=true (repository.js:141),
      // so the prev_owned fixture must explicitly send owned: false.
      const { body: before } = await req('GET', '/api/books/counts');
      await req('POST', '/api/books', {
        title: 'counts-owned ' + Math.random().toString(36).slice(2, 8), owned: true,
      });
      await req('POST', '/api/books', {
        title: 'counts-prev '  + Math.random().toString(36).slice(2, 8),
        owned: false, previously_owned: true,
      });
      const { body: after } = await req('GET', '/api/books/counts');

      assert.equal(after.owned,      before.owned      + 1, 'owned should increment by 1');
      assert.equal(after.prev_owned, before.prev_owned + 1, 'prev_owned should increment by 1');
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
          ({ body: filled } = await req('POST', '/api/books', {
            title: `${c.filter} empty filter — has value`, [c.col]: c.filledValue,
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
      const { body } = await req('POST', '/api/books', {
        title: 'Sourced Book',
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
      // Mirrors CoreFields.jsx:22-25 — the form clears these on format
      // change; the API now scrubs them too. Cases:
      //   - audiobook: binding/condition/page_count → null; duration kept.
      //   - ebook:     binding/condition/duration → null; page_count kept.
      //   - physical:  duration → null; the rest kept.
      const audio = await req('POST', '/api/books', {
        title: 'Audio Mix', format: 'audiobook',
        binding: 'paperback', condition: 'fine',
        page_count: 320, duration_minutes: 600,
      });
      assert.equal(audio.body.binding, null);
      assert.equal(audio.body.condition, null);
      assert.equal(audio.body.page_count, null);
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
      // shelf_id/unit_id/room_id/building_id/binding/condition/page_count
      // while the new audiobook-only fields persist.
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
      assert.equal(updated.page_count, null);
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

    it('rating change propagates to linked editions', async () => {
      // Linked editions stay in sync on rating/review/read_count — same
      // user-facing intent as the old title+firstAuthor heuristic, but
      // gated on an explicit work_id link so unrelated books that happen
      // to share metadata aren't dragged along.
      const a = await mkBook('Propagate Rating A');
      const b = await mkBook('Propagate Rating B');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      const { body: aLinked } = await req('GET', `/api/books/${a.id}`);
      await req('PUT', `/api/books/${a.id}`, { ...aLinked, rating: 4.5, tags: [] });
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bAfter.rating, 4.5);
    });

    it('review change propagates to linked editions', async () => {
      const a = await mkBook('Propagate Review A');
      const b = await mkBook('Propagate Review B');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      const { body: aLinked } = await req('GET', `/api/books/${a.id}`);
      await req('PUT', `/api/books/${a.id}`, { ...aLinked, review: 'Excellent.', tags: [] });
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bAfter.review, 'Excellent.');
    });

    it('non-rating edits on linked editions do not clobber existing ratings', async () => {
      // Regression for the legacy title+firstAuthor sync, which fired on
      // every updateBook — editing a description with `rating: null` in
      // the spread payload silently nulled rating on every book sharing
      // the title and first-author. Now propagation is gated on actual
      // change in rating/review/read_count, so editing other fields is
      // a no-op for the sibling's rating.
      const a = await mkBook('No-Clobber A');
      const b = await mkBook('No-Clobber B');
      await req('POST', `/api/books/${a.id}/work-link`, { other_id: b.id });
      // Set a rating on B independently.
      const { body: bLinked } = await req('GET', `/api/books/${b.id}`);
      await req('PUT', `/api/books/${b.id}`, { ...bLinked, rating: 5, tags: [] });
      // Now edit A's description — A still has no rating.
      const { body: aLinked } = await req('GET', `/api/books/${a.id}`);
      await req('PUT', `/api/books/${a.id}`, { ...aLinked, description: 'Some notes', tags: [] });
      // B's rating should survive.
      const { body: bAfter } = await req('GET', `/api/books/${b.id}`);
      assert.equal(bAfter.rating, 5);
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
});
