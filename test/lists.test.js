import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('lists', () => {
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
  });
});
