import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
      assert.deepEqual(body, []);
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

    it('rejects invalid status', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', status: 'nope' });
      assert.equal(status, 400);
    });

    it('rejects invalid ISBN-10', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_10: '123' });
      assert.equal(status, 400);
    });

    it('rejects invalid ISBN-13', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', isbn_13: '123' });
      assert.equal(status, 400);
    });

    it('rejects impossible date', async () => {
      const { status } = await req('POST', '/api/books', { title: 'X', date_started: '2026-99-99' });
      assert.equal(status, 400);
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
  });
});
