import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCoverBuffer } from '../lib/books/covers.js';

describe('fetchCoverBuffer', () => {
  it('returns null when Google Books has no items and Open Library has no cover', async () => {
    // Google Books → 200 with empty items[] → no imageLinks branch.
    // Open Library fallback → !ok → tryFetchUrl returns null. fetchCoverBuffer
    // resolves to null without touching the network.
    const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
      if (typeof url === 'string' && url.includes('googleapis.com')) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      return { ok: false };
    });
    try {
      const result = await fetchCoverBuffer('9999999999999');
      assert.equal(result, null);
      assert.equal(fetchMock.mock.callCount(), 2,
        'expected one Google Books call and one Open Library fallback call');
    } finally {
      fetchMock.mock.restore();
    }
  });
});
