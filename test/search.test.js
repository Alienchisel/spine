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
