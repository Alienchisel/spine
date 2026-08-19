import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('readlist', () => {
  let close;
  let req;

  before(async () => {
    const server = await createTestServer();
    close = server.close;
    req = server.req;
  });

  after(() => close());

  async function createBook(title) {
    const { body } = await req('POST', '/api/books', { title });
    return body.id;
  }

  it('returns empty list initially', async () => {
    const { status, body } = await req('GET', '/api/readlist');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('adds a book to the readlist via PATCH', async () => {
    const id = await createBook('Readlist Book A');
    await req('PATCH', `/api/books/${id}`, { on_readlist: true });
    const { body } = await req('GET', '/api/readlist');
    assert.ok(body.some(b => b.id === id));
  });

  it('multiple books are returned in position order', async () => {
    const id1 = await createBook('Ordered First');
    const id2 = await createBook('Ordered Second');
    const id3 = await createBook('Ordered Third');
    await req('PATCH', `/api/books/${id1}`, { on_readlist: true });
    await req('PATCH', `/api/books/${id2}`, { on_readlist: true });
    await req('PATCH', `/api/books/${id3}`, { on_readlist: true });
    const { body } = await req('GET', '/api/readlist');
    const positions = [id1, id2, id3].map(id => body.findIndex(b => b.id === id));
    assert.ok(positions[0] < positions[1] && positions[1] < positions[2],
      'books should appear in insertion order');
  });

  it('PUT /api/readlist/order reorders books', async () => {
    const id1 = await createBook('Reorder A');
    const id2 = await createBook('Reorder B');
    await req('PATCH', `/api/books/${id1}`, { on_readlist: true });
    await req('PATCH', `/api/books/${id2}`, { on_readlist: true });

    const { body: before } = await req('GET', '/api/readlist');
    const ids = before.filter(b => [id1, id2].includes(b.id)).map(b => b.id);
    const reversed = [...ids].reverse();

    await req('PUT', '/api/readlist/order', { ids: reversed });
    const { body: after } = await req('GET', '/api/readlist');
    const positions = reversed.map(id => after.findIndex(b => b.id === id));
    assert.ok(positions[0] < positions[1], 'order should be updated');
  });

  it('removing a book from readlist clears it from the list', async () => {
    const id = await createBook('To Remove from Readlist');
    await req('PATCH', `/api/books/${id}`, { on_readlist: true });
    await req('PATCH', `/api/books/${id}`, { on_readlist: false });
    const { body } = await req('GET', '/api/readlist');
    assert.ok(!body.some(b => b.id === id));
  });

  it('removed book has null readlist_position', async () => {
    const id = await createBook('Position Cleared');
    await req('PATCH', `/api/books/${id}`, { on_readlist: true });
    await req('PATCH', `/api/books/${id}`, { on_readlist: false });
    const { body } = await req('GET', `/api/books/${id}`);
    assert.equal(body.on_readlist, 0);
    assert.equal(body.readlist_position, null);
  });

  it('PUT /api/readlist/order rejects non-array ids', async () => {
    const { status } = await req('PUT', '/api/readlist/order', { ids: 'bad' });
    assert.equal(status, 400);
  });

  it('PUT /api/readlist/order rejects non-positive integer ids', async () => {
    // Pre-fix the route accepted Number.isInteger(Number(id)), which lets
    // 0 and negatives through; they then silently fail to match the
    // `WHERE id = ?` filter and the reorder no-ops without surfacing the
    // bad client. Reject up front instead.
    for (const bad of [[0, 1], [-1, 2], [1.5, 2], ['1', 2]]) {
      const { status } = await req('PUT', '/api/readlist/order', { ids: bad });
      assert.equal(status, 400, `expected 400 for ids=${JSON.stringify(bad)}`);
    }
  });

  it('GET /api/readlist returns the BookCard row shape (cover_path normalized + joined fields)', async () => {
    // Pins the serveBookCardRows() refactor at the route boundary. If the
    // helper ever changes shape, this test catches it for /api/readlist
    // independently of the shelf-route coverage.
    const stem = 'rl-shape-' + Math.random().toString(36).slice(2, 6);
    const { body: created } = await req('POST', '/api/books', {
      title: `${stem} book`,
      authors:   ['Frank Herbert'],
      narrators: ['Scott Brick'],
      tags:      [`${stem}-tag`],
      cover_path: '/uploads/9999999999-readlist.jpg',
    });
    await req('PATCH', `/api/books/${created.id}`, { on_readlist: true });

    const { body } = await req('GET', '/api/readlist');
    const row = body.find(b => b.id === created.id);
    assert.ok(row, 'created book should appear in readlist');

    // cover_path normalized through toCoverUrl: bare filename → /uploads/<filename>
    assert.equal(row.cover_path, '/uploads/9999999999-readlist.jpg');
    // authors / narrators as [{ id, name }] objects (not string arrays)
    assert.deepEqual(row.authors.map(a => a.name),   ['Frank Herbert']);
    assert.deepEqual(row.narrators.map(n => n.name), ['Scott Brick']);
    assert.ok(row.authors[0].id, 'author should carry an id');
    // tags as [{ id, name }] objects
    assert.equal(row.tags.length, 1);
    assert.equal(row.tags[0].name, `${stem}-tag`);
    assert.ok(row.tags[0].id, 'tag should carry an id');
  });
});
