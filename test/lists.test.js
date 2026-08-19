import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('lists', () => {
  let close;
  let req;

  before(async () => {
    const server = await createTestServer();
    close = server.close;
    req = server.req;
  });

  after(() => close());

  async function createList(name) {
    const { body } = await req('POST', '/api/lists', { name });
    return body;
  }

  async function createBook(title) {
    const { body } = await req('POST', '/api/books', { title });
    return body.id;
  }

  it('returns empty lists initially', async () => {
    const { status, body } = await req('GET', '/api/lists');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('GET /api/lists sorts via nrm() so diacritics fold into their base letter', async () => {
    // Lists A-Z mirrors authors/tags/series. Default COLLATE NOCASE
    // would push "Étranges Lectures" past Z; nrm() folds É→e so it
    // sorts between Edmund-Listings and Eulalia-Listings.
    const stem = 'srt' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/lists', { name: `Edmund-Listings-${stem}` });
    await req('POST', '/api/lists', { name: `Étranges-Lectures-${stem}` });
    await req('POST', '/api/lists', { name: `Eulalia-Listings-${stem}` });
    await req('POST', '/api/lists', { name: `Zenobia-Listings-${stem}` });

    const { body } = await req('GET', '/api/lists');
    const names = body.map(l => l.name);
    const idx = (n) => names.indexOf(n);

    assert.ok(idx(`Edmund-Listings-${stem}`)    < idx(`Étranges-Lectures-${stem}`), 'Étranges sorts after Edmund');
    assert.ok(idx(`Étranges-Lectures-${stem}`) < idx(`Eulalia-Listings-${stem}`),  'Étranges sorts before Eulalia');
    assert.ok(idx(`Étranges-Lectures-${stem}`) < idx(`Zenobia-Listings-${stem}`),  'Étranges sorts well before Z, not at the tail');
  });

  describe('POST /api/lists', () => {
    it('creates a list', async () => {
      const { status, body } = await req('POST', '/api/lists', { name: 'Favourites' });
      assert.equal(status, 201);
      assert.equal(body.name, 'Favourites');
      assert.ok(body.id);
    });

    it('rejects missing name', async () => {
      const { status } = await req('POST', '/api/lists', { name: '' });
      assert.equal(status, 400);
    });

    it('rejects duplicate name (case-insensitive)', async () => {
      await req('POST', '/api/lists', { name: 'Unique List' });
      const { status } = await req('POST', '/api/lists', { name: 'unique list' });
      assert.equal(status, 409);
    });

    it('rejects name over 200 chars', async () => {
      const { status } = await req('POST', '/api/lists', { name: 'x'.repeat(201) });
      assert.equal(status, 400);
    });

    it('accepts an optional description', async () => {
      const { status, body } = await req('POST', '/api/lists', {
        name: 'Described List',
        description: 'Books I plan to give as gifts.',
      });
      assert.equal(status, 201);
      assert.equal(body.description, 'Books I plan to give as gifts.');
    });

    it('stores empty description as null (not "")', async () => {
      const { body } = await req('POST', '/api/lists', { name: 'Empty Desc', description: '   ' });
      assert.equal(body.description, null);
    });

    it('rejects description over 2000 chars', async () => {
      const { status } = await req('POST', '/api/lists', { name: 'Long Desc', description: 'x'.repeat(2001) });
      assert.equal(status, 400);
    });
  });

  describe('GET /api/lists/:id', () => {
    it('returns the list with an empty books array', async () => {
      const list = await createList('Empty List');
      const { status, body } = await req('GET', `/api/lists/${list.id}`);
      assert.equal(status, 200);
      assert.equal(body.name, 'Empty List');
      assert.deepEqual(body.books, []);
      assert.equal(body.total, 0);
    });

    it('returns 404 for unknown list', async () => {
      const { status } = await req('GET', '/api/lists/99999');
      assert.equal(status, 404);
    });

    it('returns books in BookCard row shape (cover_path normalized + joined fields)', async () => {
      // Pins the serveBookCardRows() refactor at the route boundary. The
      // shelf coverage tests the same helper from the shelf side; this test
      // ensures /api/lists/:id won't silently drift if the helper changes.
      const stem = 'list-shape-' + Math.random().toString(36).slice(2, 6);
      const list = await createList(`${stem} list`);
      const { body: created } = await req('POST', '/api/books', {
        title: `${stem} book`,
        authors:   ['Ursula K. Le Guin'],
        narrators: ['Carrington MacDuffie'],
        tags:      [`${stem}-tag`],
        cover_path: '/uploads/9999999999-listdetail.jpg',
      });
      await req('POST', `/api/lists/${list.id}/books`, { book_id: created.id });

      const { body } = await req('GET', `/api/lists/${list.id}`);
      const row = body.books.find(b => b.id === created.id);
      assert.ok(row, 'added book should appear in list');

      assert.equal(row.cover_path, '/uploads/9999999999-listdetail.jpg');
      assert.deepEqual(row.authors.map(a => a.name),   ['Ursula K. Le Guin']);
      assert.deepEqual(row.narrators.map(n => n.name), ['Carrington MacDuffie']);
      assert.ok(row.authors[0].id, 'author should carry an id');
      assert.equal(row.tags.length, 1);
      assert.equal(row.tags[0].name, `${stem}-tag`);
      assert.ok(row.tags[0].id, 'tag should carry an id');
    });
  });

  describe('PUT /api/lists/:id', () => {
    it('renames the list', async () => {
      const list = await createList('Old Name');
      const { status, body } = await req('PUT', `/api/lists/${list.id}`, { name: 'New Name' });
      assert.equal(status, 200);
      assert.equal(body.name, 'New Name');
    });

    it('rejects rename to an existing list name', async () => {
      await createList('Taken Name');
      const list = await createList('Other List');
      const { status } = await req('PUT', `/api/lists/${list.id}`, { name: 'Taken Name' });
      assert.equal(status, 409);
    });

    it('allows rename to own name (no-op)', async () => {
      const list = await createList('Self Rename');
      const { status } = await req('PUT', `/api/lists/${list.id}`, { name: 'Self Rename' });
      assert.equal(status, 200);
    });

    it('updates description independently of name', async () => {
      const list = await createList('Desc Only');
      const { status, body } = await req('PUT', `/api/lists/${list.id}`, {
        description: 'Updated purpose statement.',
      });
      assert.equal(status, 200);
      assert.equal(body.name, 'Desc Only');
      assert.equal(body.description, 'Updated purpose statement.');
    });

    it('clears description when sent as empty string', async () => {
      const { body: created } = await req('POST', '/api/lists', {
        name: 'Clearable Desc',
        description: 'will be cleared',
      });
      const { body } = await req('PUT', `/api/lists/${created.id}`, { description: '' });
      assert.equal(body.description, null);
    });

    it('leaves description unchanged when key absent from PUT', async () => {
      const { body: created } = await req('POST', '/api/lists', {
        name: 'Preserve Desc',
        description: 'should survive a rename-only update',
      });
      const { body } = await req('PUT', `/api/lists/${created.id}`, { name: 'Renamed Preserve Desc' });
      assert.equal(body.name, 'Renamed Preserve Desc');
      assert.equal(body.description, 'should survive a rename-only update');
    });

    // default_sort — per-list sort memory.
    it('POST accepts default_sort and stores it', async () => {
      const { status, body } = await req('POST', '/api/lists', {
        name: 'Chrono List',
        default_sort: 'year_published',
      });
      assert.equal(status, 201);
      assert.equal(body.default_sort, 'year_published');
    });

    it('POST rejects invalid default_sort', async () => {
      const { status } = await req('POST', '/api/lists', {
        name: 'Bad Sort',
        default_sort: 'cromulent',
      });
      assert.equal(status, 400);
    });

    it('PUT updates default_sort independently of name/description', async () => {
      const list = await createList('Sort Memory');
      const { body } = await req('PUT', `/api/lists/${list.id}`, { default_sort: 'title' });
      assert.equal(body.default_sort, 'title');
      assert.equal(body.name, 'Sort Memory');
    });

    it('PUT clears default_sort when sent as null', async () => {
      const { body: created } = await req('POST', '/api/lists', {
        name: 'Clear Sort', default_sort: 'rating',
      });
      const { body } = await req('PUT', `/api/lists/${created.id}`, { default_sort: null });
      assert.equal(body.default_sort, null);
    });

    it('PUT rejects invalid default_sort', async () => {
      const list = await createList('Strict Sort');
      const { status } = await req('PUT', `/api/lists/${list.id}`, { default_sort: 'banana' });
      assert.equal(status, 400);
    });
  });

  describe('GET /api/lists/:id sort precedence', () => {
    it('uses stored default_sort when no ?sort= query is present', async () => {
      const { body: created } = await req('POST', '/api/lists', {
        name: 'Default Year Sort', default_sort: 'year_published',
      });
      // Create three books with different years and add them in non-chrono
      // order so the difference between 'added' (insert order) and
      // 'year_published' (chronological) is observable.
      const { body: a } = await req('POST', '/api/books', { title: 'Sort A', year_published: 2010 });
      const { body: b } = await req('POST', '/api/books', { title: 'Sort B', year_published: 1980 });
      const { body: c } = await req('POST', '/api/books', { title: 'Sort C', year_published: 2000 });
      await req('POST', `/api/lists/${created.id}/books`, { book_id: a.id });
      await req('POST', `/api/lists/${created.id}/books`, { book_id: b.id });
      await req('POST', `/api/lists/${created.id}/books`, { book_id: c.id });

      // No ?sort= → server falls through to default_sort (year_published asc).
      const { body } = await req('GET', `/api/lists/${created.id}`);
      const years = body.books.map(bk => bk.year_published);
      assert.deepEqual(years, [1980, 2000, 2010], 'default_sort=year_published should order by year asc');
    });

    it('explicit ?sort= query overrides default_sort', async () => {
      const { body: created } = await req('POST', '/api/lists', {
        name: 'Override Sort', default_sort: 'year_published',
      });
      const { body: a } = await req('POST', '/api/books', { title: 'X-aaa', year_published: 2010 });
      const { body: b } = await req('POST', '/api/books', { title: 'X-zzz', year_published: 1980 });
      await req('POST', `/api/lists/${created.id}/books`, { book_id: a.id });
      await req('POST', `/api/lists/${created.id}/books`, { book_id: b.id });

      const { body } = await req('GET', `/api/lists/${created.id}?sort=title`);
      // 'X-aaa' (2010) should come before 'X-zzz' (1980) because explicit title
      // sort beats the stored year-published default.
      assert.equal(body.books[0].title, 'X-aaa');
      assert.equal(body.books[1].title, 'X-zzz');
    });
  });

  describe('DELETE /api/lists/:id', () => {
    it('deletes the list', async () => {
      const list = await createList('To Delete');
      const { status } = await req('DELETE', `/api/lists/${list.id}`);
      assert.equal(status, 204);
      const { status: s } = await req('GET', `/api/lists/${list.id}`);
      assert.equal(s, 404);
    });
  });

  describe('book membership', () => {
    let listId;
    let bookId1;
    let bookId2;
    let bookId3;

    before(async () => {
      const list = await createList('Membership List');
      listId = list.id;
      bookId1 = await createBook('List Book A');
      bookId2 = await createBook('List Book B');
      bookId3 = await createBook('List Book C');
    });

    it('adds a book to the list', async () => {
      const { status } = await req('POST', `/api/lists/${listId}/books`, { book_id: bookId1 });
      assert.equal(status, 201);
      const { body } = await req('GET', `/api/lists/${listId}`);
      assert.ok(body.books.some(b => b.id === bookId1));
      assert.equal(body.total, 1);
    });

    it('adding a duplicate book is a no-op (201, not added twice)', async () => {
      await req('POST', `/api/lists/${listId}/books`, { book_id: bookId1 });
      const { body } = await req('GET', `/api/lists/${listId}`);
      assert.equal(body.books.filter(b => b.id === bookId1).length, 1);
    });

    it('books are returned in insertion position order', async () => {
      await req('POST', `/api/lists/${listId}/books`, { book_id: bookId2 });
      await req('POST', `/api/lists/${listId}/books`, { book_id: bookId3 });
      const { body } = await req('GET', `/api/lists/${listId}`);
      const ids = body.books.map(b => b.id);
      assert.equal(ids[0], bookId1);
      assert.equal(ids[1], bookId2);
      assert.equal(ids[2], bookId3);
    });

    it('PUT /api/lists/:id/order reorders books', async () => {
      const newOrder = [bookId3, bookId1, bookId2];
      const { status } = await req('PUT', `/api/lists/${listId}/order`, { ids: newOrder });
      assert.equal(status, 200);
      const { body } = await req('GET', `/api/lists/${listId}`);
      const ids = body.books.map(b => b.id);
      assert.equal(ids[0], bookId3);
      assert.equal(ids[1], bookId1);
      assert.equal(ids[2], bookId2);
    });

    it('sort=year_published orders by original year, NULLs last', async () => {
      // Three fixtures with explicit years + one with NULL year. ASC
      // pushes 1605 → 1818 → 1989 → unknown to the end; DESC reverses
      // the dated bucket and still keeps the unknown last so missing
      // metadata doesn't crowd the top.
      const { body: oldBook } = await req('POST', '/api/books', { title: 'Year-sort: Don Quixote',     year_published: 1605 });
      const { body: midBook } = await req('POST', '/api/books', { title: 'Year-sort: Frankenstein',    year_published: 1818 });
      const { body: newBook } = await req('POST', '/api/books', { title: 'Year-sort: Foucault\'s Pendulum', year_published: 1989 });
      const { body: nilBook } = await req('POST', '/api/books', { title: 'Year-sort: Unknown year' });

      const { body: yList } = await req('POST', '/api/lists', { name: 'Year-sort list' });
      for (const b of [nilBook, newBook, oldBook, midBook]) {
        await req('POST', `/api/lists/${yList.id}/books`, { book_id: b.id });
      }

      const { body: asc } = await req('GET', `/api/lists/${yList.id}?sort=year_published`);
      const ascIds = asc.books.map(b => b.id);
      assert.deepEqual(ascIds, [oldBook.id, midBook.id, newBook.id, nilBook.id]);

      const { body: desc } = await req('GET', `/api/lists/${yList.id}?sort=year_published_desc`);
      const descIds = desc.books.map(b => b.id);
      assert.deepEqual(descIds, [newBook.id, midBook.id, oldBook.id, nilBook.id]);
    });

    it('PUT /api/lists/:id/order rejects malformed id arrays', async () => {
      // Pre-fix the route only checked Array.isArray, so floats, strings,
      // negatives, and zeros silently fell through and the position UPDATE
      // matched no rows — bad client payloads went undetected.
      for (const bad of ['nope', [0, 1], [-1, 2], [1.5, 2], ['1', 2]]) {
        const { status } = await req('PUT', `/api/lists/${listId}/order`, { ids: bad });
        assert.equal(status, 400, `expected 400 for ids=${JSON.stringify(bad)}`);
      }
    });

    it('removes a book from the list', async () => {
      await req('DELETE', `/api/lists/${listId}/books/${bookId2}`);
      const { body } = await req('GET', `/api/lists/${listId}`);
      assert.ok(!body.books.some(b => b.id === bookId2));
    });

    it('rejects adding a book that does not exist', async () => {
      const { status } = await req('POST', `/api/lists/${listId}/books`, { book_id: 99999 });
      assert.equal(status, 404);
    });

    it('rejects invalid book_id', async () => {
      const { status } = await req('POST', `/api/lists/${listId}/books`, { book_id: 'abc' });
      assert.equal(status, 400);
    });
  });

  describe('GET /api/books/:id/lists', () => {
    it('returns the list ids a book belongs to', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'membership ' + Math.random().toString(36).slice(2, 6),
      });
      const a = await createList('membership-A-' + Math.random().toString(36).slice(2, 6));
      const b = await createList('membership-B-' + Math.random().toString(36).slice(2, 6));
      await req('POST', `/api/lists/${a.id}/books`, { book_id: book.id });
      await req('POST', `/api/lists/${b.id}/books`, { book_id: book.id });

      const { status, body } = await req('GET', `/api/books/${book.id}/lists`);
      assert.equal(status, 200);
      assert.ok(Array.isArray(body));
      assert.deepEqual([...body].sort((x, y) => x - y), [a.id, b.id].sort((x, y) => x - y));
    });

    it('returns [] for a book that is not in any list', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'no-lists ' + Math.random().toString(36).slice(2, 6),
      });
      const { status, body } = await req('GET', `/api/books/${book.id}/lists`);
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });

    it('returns 400 for invalid book id', async () => {
      const { status, body } = await req('GET', '/api/books/nope/lists');
      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid book id');
    });

    it('returns 200 with [] for an unknown book id (no existence check)', async () => {
      // The route doesn't probe books table — the list_books SELECT just
      // matches zero rows. Mirrors the GET /log behavior.
      const { status, body } = await req('GET', '/api/books/999999/lists');
      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });
  });

  describe('completion counts (Letterboxd-style indicators)', () => {
    it('GET /api/lists includes book_count, owned_count, finished_count per list', async () => {
      const list = await createList('Completion Overview ' + Math.random().toString(36).slice(2, 6));
      // Mix of states: 1 owned-finished, 1 owned-unread, 1 unowned-finished, 1 archived (excluded).
      const { body: a } = await req('POST', '/api/books', { title: 'Completion A', owned: true,  status: 'finished' });
      const { body: b } = await req('POST', '/api/books', { title: 'Completion B', owned: true,  status: 'unread'   });
      const { body: c } = await req('POST', '/api/books', { title: 'Completion C', owned: false, status: 'finished' });
      const { body: d } = await req('POST', '/api/books', { title: 'Completion D', owned: true,  status: 'finished', archived: true });
      for (const id of [a.id, b.id, c.id, d.id]) {
        await req('POST', `/api/lists/${list.id}/books`, { book_id: id });
      }
      const { body } = await req('GET', '/api/lists');
      const row = body.find(l => l.id === list.id);
      assert.equal(row.book_count,     3, 'archived excluded from book_count');
      assert.equal(row.owned_count,    2, 'two non-archived owned (A, B)');
      assert.equal(row.finished_count, 2, 'two non-archived finished (A, C)');
    });

    it('GET /api/lists/:id includes owned_count and finished_count alongside total', async () => {
      const list = await createList('Completion Detail ' + Math.random().toString(36).slice(2, 6));
      const { body: a } = await req('POST', '/api/books', { title: 'Detail A', owned: true,  status: 'finished' });
      const { body: b } = await req('POST', '/api/books', { title: 'Detail B', owned: true,  status: 'reading'  });
      const { body: c } = await req('POST', '/api/books', { title: 'Detail C', owned: false, status: 'unread'   });
      for (const id of [a.id, b.id, c.id]) {
        await req('POST', `/api/lists/${list.id}/books`, { book_id: id });
      }
      const { body } = await req('GET', `/api/lists/${list.id}`);
      assert.equal(body.total,          3);
      assert.equal(body.owned_count,    2);
      assert.equal(body.finished_count, 1, 'reading does not count as read');
    });

    it('counts are 0 (not undefined or null) on an empty list', async () => {
      const list = await createList('Completion Empty ' + Math.random().toString(36).slice(2, 6));
      const { body: detail } = await req('GET', `/api/lists/${list.id}`);
      assert.equal(detail.total,          0);
      assert.equal(detail.owned_count,    0);
      assert.equal(detail.finished_count, 0);
      const { body: overview } = await req('GET', '/api/lists');
      const row = overview.find(l => l.id === list.id);
      assert.equal(row.book_count,     0);
      assert.equal(row.owned_count,    0);
      assert.equal(row.finished_count, 0);
    });
  });
});
