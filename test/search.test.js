import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('search', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  async function req(path) {
    const res = await fetch(`${url}${path}`);
    return { status: res.status, body: await res.json() };
  }

  it('GET /api/search returns [] when q is missing', async () => {
    const { status, body } = await req('/api/search');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('GET /api/search returns [] for whitespace-only q', async () => {
    const { status, body } = await req('/api/search?q=%20%20%20');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('GET /api/search returns [] for empty q', async () => {
    const { status, body } = await req('/api/search?q=');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  it('GET /api/search returns 502 when the Open Library request throws', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      throw new Error('boom — DNS, abort, etc.');
    });
    try {
      const { status, body } = await req('/api/search?q=anything');
      assert.equal(status, 502);
      assert.equal(body.error, 'Failed to reach Open Library');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('GET /api/search returns 502 when Open Library responds with !ok', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return { ok: false, status: 503 };
    });
    try {
      const { status, body } = await req('/api/search?q=anything');
      assert.equal(status, 502);
      assert.equal(body.error, 'Open Library unavailable');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('GET /api/search rewrites hyphenated ISBN-13 queries to q=isbn:<digits>', async () => {
    // Hyphens and spaces are stripped, /^\d{10}(\d{3})?$/ matches, and the
    // outbound query becomes q=isbn:<13 digits>.
    let outboundUrl = null;
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      outboundUrl = targetStr;
      return { ok: true, json: async () => ({ docs: [] }) };
    });
    try {
      const { status, body } = await req('/api/search?q=978-1-234-56789-7');
      assert.equal(status, 200);
      assert.deepEqual(body, []);
      assert.ok(outboundUrl, 'outbound Open Library call should have been made');
      assert.ok(outboundUrl.includes('q=isbn%3A9781234567897'),
        `expected q=isbn%3A9781234567897 in outbound URL, got: ${outboundUrl}`);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('GET /api/search maps an Open Library doc into the Spine result shape', async () => {
    const fakeDoc = {
      key: '/works/OL456W',
      title: 'A Sample Book',
      author_name: ['Jane Doe', 'John Roe'],
      publisher: ['Acme Press', 'Other Press'],
      number_of_pages_median: 320,
      cover_i: 9876,
      isbn: ['1234567890', '9781234567897', 'BADISBN'],
    };
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return { ok: true, json: async () => ({ docs: [fakeDoc] }) };
    });
    try {
      const { status, body } = await req('/api/search?q=sample');
      assert.equal(status, 200);
      assert.equal(body.length, 1);
      const r = body[0];
      assert.equal(r.title, 'A Sample Book');
      assert.deepEqual(r.authors, ['Jane Doe', 'John Roe']);
      assert.equal(r.publisher, 'Acme Press');
      assert.equal(r.page_count, 320);
      assert.equal(r.cover_url, 'https://covers.openlibrary.org/b/id/9876-M.jpg');
      assert.equal(r.isbn_10, '1234567890');
      assert.equal(r.isbn_13, '9781234567897');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('GET /api/search/description returns 200 with null when Open Library !ok', async () => {
    // Soft-failure contract: a missing description must not break the add-book
    // flow. The route returns 200 with { description: null } rather than 502.
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return { ok: false, status: 503 };
    });
    try {
      const { status, body } = await req('/api/search/description?key=/works/OL12345W');
      assert.equal(status, 200);
      assert.equal(body.description, null);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('GET /api/search/description normalizes object-form description.value to a string', async () => {
    // Open Library returns description as either a string or { type, value }.
    // The route flattens the object form to its `.value`. Localhost requests
    // (this test's own call into the in-process server) must still hit the
    // real fetch, so the mock branches on URL.
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return {
        ok: true,
        json: async () => ({ description: { value: 'Some description' } }),
      };
    });
    try {
      const { status, body } = await req('/api/search/description?key=/works/OL12345W');
      assert.equal(status, 200);
      assert.equal(body.description, 'Some description');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('GET /api/search/description returns 400 when key is missing or malformed', async () => {
    // The /works/ prefix guard runs before any network call.
    const a = await req('/api/search/description');
    assert.equal(a.status, 400);
    assert.equal(a.body.error, 'Invalid key');

    const b = await req('/api/search/description?key=/authors/OL123A');
    assert.equal(b.status, 400);
    assert.equal(b.body.error, 'Invalid key');
  });
});
