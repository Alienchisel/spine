import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('readlist', () => {
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
});
