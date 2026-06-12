// Tags index endpoint. Mirrors authors-index shape: row per tag with
// book_count, sorted by name (NOCASE). pruneOrphanTags runs on book
// mutations so the LEFT JOIN's 0-count branch is rarely exercised in
// practice, but the column is what the prune-flow sort relies on.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('tags — index', () => {
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

  it('GET /api/tags returns each tag with book_count, sorted by name', async () => {
    const stem = 'tag' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-A`, tags: [`zeta-${stem}`, `alpha-${stem}`] });
    await req('POST', '/api/books', { title: `${stem}-B`, tags: [`alpha-${stem}`] });

    const { status, body } = await req('GET', '/api/tags');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));

    const alpha = body.find(t => t.name === `alpha-${stem}`);
    const zeta  = body.find(t => t.name === `zeta-${stem}`);
    assert.ok(alpha && zeta, 'both fixture tags should appear');
    assert.equal(alpha.book_count, 2);
    assert.equal(zeta.book_count,  1);

    // Alphabetical via nrm(): alpha-* sorts before zeta-*.
    const aIdx = body.findIndex(t => t.name === `alpha-${stem}`);
    const zIdx = body.findIndex(t => t.name === `zeta-${stem}`);
    assert.ok(aIdx < zIdx, 'alpha should sort before zeta');
  });

  it('GET /api/tags sorts via nrm() so diacritics fold into their base letter', async () => {
    // A tag named "Élite" would sort past "z" under default COLLATE
    // NOCASE because É is codepoint 201. nrm() folds it to "elite" so
    // it lands between Edmund and Eulalia, not at the tail.
    const stem = 'srt' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-A`, tags: [`Edmund-${stem}`, `Étranger-${stem}`, `Eulalia-${stem}`, `Zenobia-${stem}`] });

    const { body } = await req('GET', '/api/tags');
    const names = body.map(t => t.name);
    const idx = (n) => names.indexOf(n);

    assert.ok(idx(`Edmund-${stem}`)   < idx(`Étranger-${stem}`), 'Étranger sorts after Edmund');
    assert.ok(idx(`Étranger-${stem}`) < idx(`Eulalia-${stem}`),  'Étranger sorts before Eulalia');
    assert.ok(idx(`Étranger-${stem}`) < idx(`Zenobia-${stem}`),  'Étranger sorts well before Z, not at the tail');
  });
});
