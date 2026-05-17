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
