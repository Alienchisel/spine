import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { createTestServer } from './helpers.js';

describe('POST /api/upload', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  it('returns 200 with /uploads/<filename>.jpg on a valid JPEG upload', async () => {
    // Mock the disk write so the test is hermetic. The route still runs the
    // full pipeline: multer accepts the image, saveCoverFromBuffer detects
    // JPEG, writes (mocked), and returns the generated filename.
    let writtenPath = null;
    let writtenBytes = null;
    const writeMock = mock.method(fs.promises, 'writeFile', async (p, b) => {
      writtenPath = p;
      writtenBytes = b;
    });
    try {
      const jpeg = new Uint8Array(64);
      jpeg[0] = 0xFF; jpeg[1] = 0xD8; jpeg[2] = 0xFF; jpeg[3] = 0xE0;
      const fd = new FormData();
      fd.append('cover', new Blob([jpeg], { type: 'image/jpeg' }), 'cover.jpg');
      const res = await fetch(`${url}/api/upload`, { method: 'POST', body: fd });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.match(body.path, /^\/uploads\/\d+-[a-z0-9]+\.jpg$/i);
      assert.ok(writtenPath?.endsWith(body.path.replace('/uploads/', '')));
      assert.equal(writtenBytes?.length, 64);
    } finally {
      writeMock.mock.restore();
    }
  });

  it('returns 400 when no file is attached', async () => {
    // Multer accepts the multipart body but leaves req.file undefined when no
    // 'cover' field is present, so the route's own guard fires.
    const fd = new FormData();
    const res = await fetch(`${url}/api/upload`, { method: 'POST', body: fd });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'No file uploaded');
  });

  it('rejects non-image multipart files via the multer fileFilter', async () => {
    // The fileFilter tags the rejection with status=400; the global error
    // handler surfaces the message rather than swallowing it.
    const fd = new FormData();
    fd.append('cover', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    const res = await fetch(`${url}/api/upload`, { method: 'POST', body: fd });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'Only images allowed');
  });

  it('rejects oversized files via the multer size limit (MulterError → 400)', async () => {
    // Multer's LIMIT_FILE_SIZE produces a MulterError; the error handler
    // maps any MulterError to 400 with its own message rather than 500.
    const big = new Uint8Array(10 * 1024 * 1024 + 1024);
    const fd = new FormData();
    fd.append('cover', new Blob([big], { type: 'image/jpeg' }), 'big.jpg');
    const res = await fetch(`${url}/api/upload`, { method: 'POST', body: fd });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /File too large|file size/i);
  });
});

describe('POST /api/upload/fetch', () => {
  let url;
  let close;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  async function req(body) {
    const res = await fetch(`${url}/api/upload/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json() };
  }

  it('returns 400 when url is missing (new URL(undefined) throws)', async () => {
    const { status, body } = await req({});
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid URL');
  });

  it('returns 400 for non-HTTPS URLs', async () => {
    // The HTTPS guard fires before any network call, so this stays hermetic.
    const { status, body } = await req({ url: 'http://example.com/cover.jpg' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Only HTTPS URLs are allowed');
  });

  it('returns 400 for syntactically invalid URLs', async () => {
    const { status, body } = await req({ url: 'not a url' });
    assert.equal(status, 400);
    assert.equal(body.error, 'Invalid URL');
  });

  it('returns 400 when the downloaded body exceeds 10 MiB even with no content-length', async () => {
    // Safety net for missing/lying content-length headers: the post-download
    // buffer.length check at routes/uploads.js:51 must still reject oversized
    // payloads.
    const oversizeBuf = new ArrayBuffer(10 * 1024 * 1024 + 1);
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return {
        ok: true,
        headers: {
          get: (h) => h.toLowerCase() === 'content-type' ? 'image/jpeg' : null,
        },
        arrayBuffer: async () => oversizeBuf,
      };
    });
    try {
      const { status, body } = await req({ url: 'https://example.test/sneaky.jpg' });
      assert.equal(status, 400);
      assert.equal(body.error, 'Image too large');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('returns 400 when the remote content-length exceeds the 10 MiB cap', async () => {
    const oversize = String(10 * 1024 * 1024 + 1);
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return {
        ok: true,
        headers: {
          get: (h) => {
            const k = h.toLowerCase();
            if (k === 'content-type') return 'image/jpeg';
            if (k === 'content-length') return oversize;
            return null;
          },
        },
      };
    });
    try {
      const { status, body } = await req({ url: 'https://example.test/huge.jpg' });
      assert.equal(status, 400);
      assert.equal(body.error, 'Image too large');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('returns 502 when the remote fetch responds with !ok', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return { ok: false, status: 500, headers: { get: () => null } };
    });
    try {
      const { status, body } = await req({ url: 'https://example.test/missing.jpg' });
      assert.equal(status, 502);
      assert.equal(body.error, 'Failed to fetch cover');
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('returns 400 when the fetched URL has a non-image content-type', async () => {
    // Mock fetch so the outbound request gets a text/plain response. Localhost
    // calls (this test's own request to the in-process server) must still hit
    // the real fetch, so the mock branches on URL.
    const originalFetch = globalThis.fetch;
    const fetchMock = mock.method(globalThis, 'fetch', async (target, init) => {
      const targetStr = typeof target === 'string' ? target : String(target);
      if (targetStr.startsWith(url)) return originalFetch(target, init);
      return {
        ok: true,
        headers: { get: (h) => h.toLowerCase() === 'content-type' ? 'text/plain' : null },
      };
    });
    try {
      const { status, body } = await req({ url: 'https://example.test/cover.txt' });
      assert.equal(status, 400);
      assert.equal(body.error, 'URL does not point to an image');
    } finally {
      fetchMock.mock.restore();
    }
  });
});
