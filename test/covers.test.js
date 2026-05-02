import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { fetchCoverBuffer, deleteLocalCover, saveCoverFromBuffer, detectImageExt } from '../lib/books/covers.js';

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

  it('swallows Google Books errors and still returns Open Library buffer', async () => {
    // The Google-side try/catch must not surface — a thrown fetch (DNS, JSON
    // parse, etc.) should fall through to Open Library, not propagate.
    const olBuf = new ArrayBuffer(2500);
    new Uint8Array(olBuf).fill(0xCD);
    const calls = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
      calls.push(typeof url === 'string' ? url : String(url));
      if (typeof url === 'string' && url.includes('googleapis.com')) {
        throw new Error('boom — Google unreachable');
      }
      if (typeof url === 'string' && url.includes('covers.openlibrary.org')) {
        return { ok: true, arrayBuffer: async () => olBuf };
      }
      return { ok: false };
    });
    try {
      const result = await fetchCoverBuffer('9999999999999');
      assert.ok(Buffer.isBuffer(result), 'expected a Buffer from the Open Library fallback');
      assert.equal(result.length, 2500);
      assert.equal(calls.length, 2, 'expected one Google attempt and one Open Library fetch');
      assert.ok(calls[1].includes('covers.openlibrary.org'));
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('falls through to Open Library when the Google image is under 2000 bytes', async () => {
    // The size guard rejects placeholder/1×1 images Google sometimes returns.
    // After it triggers, the function must try Open Library before giving up.
    const tinyBuf = new ArrayBuffer(500);
    const calls = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
      calls.push(typeof url === 'string' ? url : String(url));
      if (typeof url === 'string' && url.includes('googleapis.com')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ volumeInfo: { imageLinks: {
              thumbnail: 'http://example.test/tiny.jpg',
            } } }],
          }),
        };
      }
      if (typeof url === 'string' && url.includes('example.test')) {
        return { ok: true, arrayBuffer: async () => tinyBuf };
      }
      return { ok: false };
    });
    try {
      const result = await fetchCoverBuffer('9999999999999');
      assert.equal(result, null);
      assert.equal(calls.length, 3,
        'expected Google Books, the (rejected) tiny image, and Open Library fallback');
      assert.ok(calls[2].includes('covers.openlibrary.org'),
        'third call should be Open Library fallback');
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

describe('deleteLocalCover', () => {
  it('refuses to unlink a path-traversal filename', () => {
    // Defense in depth: a malformed cover_path slipping past toFilename must
    // not let a cover replacement turn into arbitrary file deletion.
    const unlinkMock = mock.method(fs, 'unlink', (_path, cb) => cb(null));
    try {
      deleteLocalCover('../x.webp');
      assert.equal(unlinkMock.mock.callCount(), 0,
        'fs.unlink must not be called for filenames containing path separators');
    } finally {
      unlinkMock.mock.restore();
    }
  });

  it('refuses to unlink an absolute path', () => {
    const unlinkMock = mock.method(fs, 'unlink', (_path, cb) => cb(null));
    try {
      deleteLocalCover('/etc/passwd');
      assert.equal(unlinkMock.mock.callCount(), 0);
    } finally {
      unlinkMock.mock.restore();
    }
  });

  it('returns early without unlink when filename is empty/null', () => {
    const unlinkMock = mock.method(fs, 'unlink', (_path, cb) => cb(null));
    try {
      deleteLocalCover('');
      deleteLocalCover(null);
      deleteLocalCover(undefined);
      assert.equal(unlinkMock.mock.callCount(), 0);
    } finally {
      unlinkMock.mock.restore();
    }
  });
});

describe('saveCoverFromBuffer', () => {
  it('passes a JPEG buffer through unchanged and returns a .jpg filename', async () => {
    // The function should detect 0xFF 0xD8 0xFF as JPEG, skip the WebP→JPG
    // conversion path, and write the original bytes verbatim.
    const jpegBuf = Buffer.alloc(64, 0);
    jpegBuf[0] = 0xFF; jpegBuf[1] = 0xD8; jpegBuf[2] = 0xFF; jpegBuf[3] = 0xE0;
    let writtenPath = null;
    let writtenBuf = null;
    const writeMock = mock.method(fs.promises, 'writeFile', async (p, b) => {
      writtenPath = p;
      writtenBuf = b;
    });
    try {
      const filename = await saveCoverFromBuffer(jpegBuf);
      assert.match(filename, /^\d+-[a-z0-9]+\.jpg$/i, 'filename should end in .jpg');
      assert.ok(writtenPath?.endsWith(filename), 'should write to uploads/<filename>');
      assert.equal(writtenBuf, jpegBuf, 'buffer should pass through unchanged (no re-encoding)');
    } finally {
      writeMock.mock.restore();
    }
  });

  it('throws on unrecognized image format', async () => {
    const garbage = Buffer.alloc(64, 0x00);
    const writeMock = mock.method(fs.promises, 'writeFile', async () => {});
    try {
      await assert.rejects(
        () => saveCoverFromBuffer(garbage),
        /Unrecognized image format/,
      );
      assert.equal(writeMock.mock.callCount(), 0, 'must not write when format detection fails');
    } finally {
      writeMock.mock.restore();
    }
  });
});

describe('detectImageExt', () => {
  // Table-driven over the four signature branches plus a couple of explicit
  // misses. Each fixture is the magic-byte prefix padded to 12 bytes so the
  // length guard in detectImageExt() is satisfied.
  function withPrefix(prefix) {
    const buf = Buffer.alloc(12, 0);
    Buffer.from(prefix).copy(buf);
    return buf;
  }

  const cases = [
    { name: 'JPEG',  buf: withPrefix([0xFF, 0xD8, 0xFF, 0xE0]),                                  expected: 'jpg' },
    { name: 'PNG',   buf: withPrefix([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),          expected: 'png' },
    { name: 'GIF87', buf: withPrefix([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),                      expected: 'gif' },
    { name: 'GIF89', buf: withPrefix([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),                      expected: 'gif' },
    { name: 'WEBP',  buf: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP')]), expected: 'webp' },
    { name: 'all-zero garbage', buf: Buffer.alloc(12, 0),                                        expected: null },
  ];

  for (const { name, buf, expected } of cases) {
    it(`recognizes ${name} as ${expected ?? 'null'}`, () => {
      assert.equal(detectImageExt(buf), expected);
    });
  }

  it('returns null for buffers shorter than the minimum 12 bytes', () => {
    assert.equal(detectImageExt(Buffer.from([0xFF, 0xD8, 0xFF])), null);
    assert.equal(detectImageExt(null), null);
    assert.equal(detectImageExt(undefined), null);
  });
});
