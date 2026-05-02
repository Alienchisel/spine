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

  it('returns a Buffer and normalizes Google Books image URL (strip edge=curl, force zoom=0)', async () => {
    const arrBuf = new ArrayBuffer(3000);
    new Uint8Array(arrBuf).fill(0xAB);
    const calls = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
      calls.push(typeof url === 'string' ? url : String(url));
      if (typeof url === 'string' && url.includes('googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ volumeInfo: { imageLinks: {
              thumbnail: 'http://example.test/image?zoom=1&edge=curl',
            } } }],
          }),
        };
      }
      if (typeof url === 'string' && url.includes('example.test')) {
        return { ok: true, arrayBuffer: async () => arrBuf };
      }
      return { ok: false };
    });
    try {
      const result = await fetchCoverBuffer('9999999999999');
      assert.ok(Buffer.isBuffer(result), 'expected a Buffer');
      assert.equal(result.length, 3000);
      assert.equal(calls.length, 2, 'should not fall through to Open Library');
      assert.equal(calls[1], 'http://example.test/image?zoom=0',
        'image URL should have edge=curl stripped and zoom forced to 0');
    } finally {
      fetchMock.mock.restore();
    }
  });
});
