// Response compression and cache headers. Own file (own process) because
// app.js only mounts the client/dist static handler and SPA fallback when
// NODE_ENV is 'production' at import time.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'production';
const { createTestServer } = await import('./helpers.js');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distAssets = path.join(root, 'client/dist/assets');
const hasDist = fs.existsSync(distAssets);

// Raw GET so the Content-Encoding the server chose is visible (fetch would
// negotiate and decode on its own).
function rawGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    }).on('error', reject);
  });
}

describe('compression and cache headers', () => {
  let url, close, req;
  before(async () => ({ url, close, req } = await createTestServer()));
  after(() => close());

  it('gzips API JSON when the client accepts it', async () => {
    // Enough rows to clear compression's 1 KB threshold.
    for (let i = 0; i < 15; i++) {
      await req('POST', '/api/books', { title: `Gzip Fixture ${i}`, description: 'x'.repeat(200) });
    }
    const res = await rawGet(`${url}/api/books?limit=50`, { 'Accept-Encoding': 'gzip' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
  });

  it('caches uploads for 30 days (every upload has a unique name)', async () => {
    const name = `zz-cache-test-${process.pid}.txt`;
    const file = path.join(root, 'uploads', name);
    fs.writeFileSync(file, 'cache header probe');
    try {
      const res = await rawGet(`${url}/uploads/${name}`);
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['cache-control'], /max-age=2592000/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('caches hashed build assets for a year, immutable', { skip: !hasDist && 'client/dist not built' }, async () => {
    const asset = fs.readdirSync(distAssets).find(f => f.endsWith('.js'));
    const res = await rawGet(`${url}/assets/${asset}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  });

  it('never lets index.html or the SPA fallback go stale', { skip: !hasDist && 'client/dist not built' }, async () => {
    const index = await rawGet(`${url}/`);
    assert.equal(index.headers['cache-control'], 'no-cache');
    const deep = await rawGet(`${url}/books/123`);
    assert.equal(deep.statusCode, 200);
    assert.equal(deep.headers['cache-control'], 'no-cache');
  });
});
