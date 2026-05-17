// Author bio/portrait refresh tests. Stubs global.fetch so the suite
// doesn't hit Open Library — the route's other behaviors (GET shape,
// PATCH gender, alias links) are covered elsewhere.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';
import { parseYear, normalizeBio } from '../lib/authors/openLibrary.js';

describe('authors — Open Library refresh', () => {
  let url;
  let close;
  const realFetch = global.fetch;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
  });

  after(() => close());

  afterEach(() => { global.fetch = realFetch; });

  async function req(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, body: data };
  }

  function stubFetch(handlers) {
    // handlers: array of { match: (url) => bool, respond: () => fetchResponse }
    // Calls fall through to realFetch when nothing matches — so the
    // test-server's own loopback fetches (none expected here, but
    // defensive) still work.
    global.fetch = async (input, init) => {
      const u = typeof input === 'string' ? input : input.url;
      const h = handlers.find(h => h.match(u));
      if (h) return h.respond(u, init);
      return realFetch(input, init);
    };
  }

  function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  }

  it('parseYear extracts a 4-digit year from various OL date formats', () => {
    assert.equal(parseYear('1938'),            1938);
    assert.equal(parseYear('July 18, 1938'),   1938);
    assert.equal(parseYear('1938-07-18'),      1938);
    assert.equal(parseYear('19'),              null);
    assert.equal(parseYear(''),                null);
    assert.equal(parseYear(null),              null);
    assert.equal(parseYear(undefined),         null);
  });

  it('normalizeBio handles plain strings and { type, value } objects', () => {
    assert.equal(normalizeBio('Hello'),                              'Hello');
    assert.equal(normalizeBio({ type: '/type/text', value: 'Hi' }),  'Hi');
    assert.equal(normalizeBio(''),                                   null);
    assert.equal(normalizeBio(null),                                 null);
    assert.equal(normalizeBio({ type: '/type/text', value: '' }),    null);
  });

  it('round-trips bio + dates from a mocked OL response', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Refresh Test Book', authors: ['Mockable Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Pre-refresh: bio fields are null and bio_fetched_at is null.
    const { body: pre } = await req('GET', `/api/authors/${aid}`);
    assert.equal(pre.bio, null);
    assert.equal(pre.bio_fetched_at, null);

    stubFetch([
      {
        match: (u) => u.startsWith('https://openlibrary.org/search/authors.json'),
        respond: () => jsonResponse({
          docs: [{ key: 'OL12345A', name: 'Mockable Author' }],
        }),
      },
      {
        match: (u) => u === 'https://openlibrary.org/authors/OL12345A.json',
        respond: () => jsonResponse({
          bio:        { type: '/type/text', value: 'A mock-driven novelist born and died on this same imaginary date.' },
          birth_date: 'March 4, 1900',
          death_date: '1972',
          photos:     [-1], // -1 means OL has no photo on file
        }),
      },
    ]);

    const refresh = await req('POST', `/api/authors/${aid}/refresh`);
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.bio.startsWith('A mock-driven'), true);
    assert.equal(refresh.body.birth_year, 1900);
    assert.equal(refresh.body.death_year, 1972);
    assert.equal(refresh.body.ol_key, 'OL12345A');
    assert.ok(refresh.body.bio_fetched_at, 'bio_fetched_at should be set');
    // Photo skipped because OL returned -1 (no photo).
    assert.equal(refresh.body.photo_path, null);

    // GET reflects what refresh persisted.
    const { body: post } = await req('GET', `/api/authors/${aid}`);
    assert.equal(post.birth_year, 1900);
    assert.equal(post.death_year, 1972);
  });

  it('bumps bio_fetched_at even when OL has no match', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'No Match Book', authors: ['Indie Pseudonym ' + Date.now()], fiction: true,
    });
    const aid = book.authors[0].id;

    stubFetch([
      {
        match: (u) => u.startsWith('https://openlibrary.org/search/authors.json'),
        respond: () => jsonResponse({ docs: [] }),
      },
    ]);

    const refresh = await req('POST', `/api/authors/${aid}/refresh`);
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.bio, null);
    assert.equal(refresh.body.ol_key, null);
    // bio_fetched_at SHOULD bump so the auto-refresh effect doesn't
    // keep retrying every visit. Manual button re-triggers if desired.
    assert.ok(refresh.body.bio_fetched_at, 'bio_fetched_at should bump on miss');
  });

  it('PATCH bio persists the text and bumps bio_fetched_at to suppress auto-refresh', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Bio Edit Book', authors: ['Bio Edit Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Pre-edit: no bio, bio_fetched_at null (would normally trigger
    // the auto-refresh effect on next visit).
    const { body: pre } = await req('GET', `/api/authors/${aid}`);
    assert.equal(pre.bio, null);
    assert.equal(pre.bio_fetched_at, null);

    const set = await req('PATCH', `/api/authors/${aid}`, { bio: '  A bio with leading whitespace.  ' });
    assert.equal(set.status, 200);
    assert.equal(set.body.bio, 'A bio with leading whitespace.', 'bio should be trimmed');
    assert.ok(set.body.bio_fetched_at, 'bio_fetched_at should bump so auto-refresh stops retrying');

    // Empty string clears back to null.
    const cleared = await req('PATCH', `/api/authors/${aid}`, { bio: '' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.bio, null);

    // Non-string body → 400.
    const bad = await req('PATCH', `/api/authors/${aid}`, { bio: 42 });
    assert.equal(bad.status, 400);

    // Combined gender + bio update still works (the PATCH is intentionally
    // additive rather than one-field-at-a-time).
    const combo = await req('PATCH', `/api/authors/${aid}`, { gender: 'female', bio: 'Final bio.' });
    assert.equal(combo.status, 200);
    assert.equal(combo.body.gender, 'female');
    assert.equal(combo.body.bio,    'Final bio.');
  });

  it('manual upload writes a portrait and overrides any OL-fetched one', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Upload Test Book', authors: ['Manual Portrait Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Minimal valid JPEG: SOI + APP0 stub + EOI. Large enough that the
    // 1 KB OL-placeholder filter wouldn't apply (this endpoint doesn't
    // filter, but exercise a realistic size).
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
    const jpegPadding = Buffer.alloc(2048, 0);
    const jpegEOI = Buffer.from([0xFF, 0xD9]);
    const jpeg = Buffer.concat([jpegHeader, jpegPadding, jpegEOI]);

    const fd = new FormData();
    fd.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'portrait.jpg');
    const res = await fetch(`${url}/api/authors/${aid}/photo`, { method: 'POST', body: fd });
    assert.equal(res.status, 200);
    const updated = await res.json();
    assert.ok(updated.photo_path?.startsWith('/uploads/authors/'), 'photo_path should land in uploads/authors/');
    assert.ok(updated.photo_path.includes(`${aid}-`), 'filename should include the author id');

    // Subsequent GET shows the uploaded photo.
    const { body: post } = await req('GET', `/api/authors/${aid}`);
    assert.equal(post.photo_path, updated.photo_path);

    // DELETE clears it.
    const del = await req('DELETE', `/api/authors/${aid}/photo`);
    assert.equal(del.status, 200);
    assert.equal(del.body.photo_path, null);
  });

  it('rejects non-image uploads with 400', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Bad Upload Book', authors: ['Bad Upload Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    const fd = new FormData();
    fd.append('photo', new Blob(['not an image'], { type: 'text/plain' }), 'noimage.txt');
    const res = await fetch(`${url}/api/authors/${aid}/photo`, { method: 'POST', body: fd });
    assert.equal(res.status, 400);
  });

  it('returns 502 when the OL endpoint itself errors', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Bad Network Book', authors: ['Network Failure Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    stubFetch([
      {
        match: (u) => u.startsWith('https://openlibrary.org/'),
        respond: () => new Response('Server error', { status: 500 }),
      },
    ]);

    const refresh = await req('POST', `/api/authors/${aid}/refresh`);
    assert.equal(refresh.status, 502);
    // No state was persisted, so bio_fetched_at stays null and the
    // auto-refresh effect will try again on the next visit.
    const { body: after } = await req('GET', `/api/authors/${aid}`);
    assert.equal(after.bio_fetched_at, null);
  });
});
