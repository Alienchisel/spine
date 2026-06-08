// Author bio/portrait refresh tests. Stubs global.fetch so the suite
// doesn't hit Open Library — the route's other behaviors (GET shape,
// PATCH gender, alias links) are covered elsewhere.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';
import { parseDate, normalizeBio, stripBioDates } from '../lib/authors/openLibrary.js';

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

  it('parseDate normalizes OL date strings into YYYY / YYYY-MM-DD form', () => {
    assert.equal(parseDate('1938'),                 '1938');
    assert.equal(parseDate('1938-07-18'),           '1938-07-18');
    assert.equal(parseDate('1938-07'),              '1938-07');
    assert.equal(parseDate('July 18, 1938'),        '1938-07-18');
    assert.equal(parseDate('July 18 1938'),         '1938-07-18');
    assert.equal(parseDate('18 July 1938'),         '1938-07-18');
    assert.equal(parseDate('March 4, 1900'),        '1900-03-04');
    assert.equal(parseDate('March 1900'),           '1900-03');
    // Fallback grabs a bare year when the rest is gibberish.
    assert.equal(parseDate('around 1938 give or take'), '1938');
    // Junk / empty / nullish.
    assert.equal(parseDate('19'),       null);
    assert.equal(parseDate(''),         null);
    assert.equal(parseDate(null),       null);
    assert.equal(parseDate(undefined),  null);
  });

  it('stripBioDates removes the leading date paren in every shape OL emits', () => {
    // Year-only and ranged forms, with and without prefixes.
    assert.equal(stripBioDates('Smith (1962) was an English writer.'),         'Smith was an English writer.');
    assert.equal(stripBioDates('Smith (1850-1920) was an English writer.'),    'Smith was an English writer.');
    assert.equal(stripBioDates('Smith (1850 – 1920) was an English writer.'),  'Smith was an English writer.');
    assert.equal(stripBioDates('Smith (born 1962) was an English writer.'),    'Smith was an English writer.');
    assert.equal(stripBioDates('Smith (b. 1850) was an English writer.'),      'Smith was an English writer.');
    assert.equal(stripBioDates('Smith (d. 1920) was an English writer.'),      'Smith was an English writer.');
    assert.equal(stripBioDates('Smith (c. 1850-1920) was an English writer.'), 'Smith was an English writer.');
    assert.equal(stripBioDates('Smith (fl. 1850) was an English writer.'),     'Smith was an English writer.');
    // Day + month + year (Dan Abnett shape).
    assert.equal(stripBioDates('Abnett (born 12 October 1965) is an English writer.'), 'Abnett is an English writer.');
    // BCE / negative-year forms.
    assert.equal(stripBioDates('Plato (c. 428 BCE – 348 BCE) was a Greek philosopher.'), 'Plato was a Greek philosopher.');

    // Non-date parens are preserved (only date-shaped parens are stripped).
    assert.equal(
      stripBioDates('Seneca (commonly known as Seneca the Younger) was a Roman Stoic.'),
      'Seneca (commonly known as Seneca the Younger) was a Roman Stoic.',
    );

    // Mid-bio publication year survives — the regex is anchored to the
    // start of the bio (within ~120 chars), so "(1973)" later in the
    // text isn't touched.
    const midBio = 'Smith was an American novelist whose first major work, Lighthouse (1973), drew on his New England childhood.';
    assert.equal(stripBioDates(midBio), midBio);

    // Empty / null passthrough.
    assert.equal(stripBioDates(null),      null);
    assert.equal(stripBioDates(undefined), undefined);
    assert.equal(stripBioDates(''),        '');
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
    // "March 4, 1900" parses to a full-precision birth_date; the
    // year-only "1972" stays year-only.
    assert.equal(refresh.body.birth_date, '1900-03-04');
    assert.equal(refresh.body.death_date, '1972');
    assert.equal(refresh.body.ol_key, 'OL12345A');
    assert.ok(refresh.body.bio_fetched_at, 'bio_fetched_at should be set');
    // Photo skipped because OL returned -1 (no photo).
    assert.equal(refresh.body.photo_path, null);

    // GET reflects what refresh persisted.
    const { body: post } = await req('GET', `/api/authors/${aid}`);
    assert.equal(post.birth_date, '1900-03-04');
    assert.equal(post.death_date, '1972');
  });

  it('refresh is non-destructive: preserves user-set bio / dates / photo', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Preserve Test Book', authors: ['Already Curated Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Pre-set every user-facing field so we can verify the refresh
    // doesn't clobber any of them.
    await req('PATCH', `/api/authors/${aid}`, {
      bio:        'A hand-written bio that the user worked hard on.',
      birth_date: '1850',
      death_date: '1920',
    });
    // Upload a photo by hand so photo_path is set ahead of the refresh.
    const jpegHeader  = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
    const jpegPadding = Buffer.alloc(2048, 0);
    const jpegEOI     = Buffer.from([0xFF, 0xD9]);
    const jpeg = Buffer.concat([jpegHeader, jpegPadding, jpegEOI]);
    const fd = new FormData();
    fd.append('photo', new Blob([jpeg], { type: 'image/jpeg' }), 'manual.jpg');
    const uploaded = await (await fetch(`${url}/api/authors/${aid}/photo`, { method: 'POST', body: fd })).json();
    const userPhotoPath = uploaded.photo_path;

    // OL returns a hit with entirely different values — none of which
    // should land on the row because the user has already curated everything.
    stubFetch([
      {
        match: (u) => u.startsWith('https://openlibrary.org/search/authors.json'),
        respond: () => jsonResponse({ docs: [{ key: 'OL99999A', name: 'Already Curated Author' }] }),
      },
      {
        match: (u) => u === 'https://openlibrary.org/authors/OL99999A.json',
        respond: () => jsonResponse({
          bio:        'OL would replace the user bio with this generic blurb.',
          birth_date: '1700',
          death_date: '1800',
          photos:     [12345], // would download but get deleted as an orphan
        }),
      },
      {
        match: (u) => u.startsWith('https://covers.openlibrary.org/'),
        // Return a >1 KB buffer so the placeholder filter doesn't drop it.
        respond: () => new Response(Buffer.alloc(4096, 0xAB), { status: 200 }),
      },
    ]);

    const refresh = await req('POST', `/api/authors/${aid}/refresh`);
    assert.equal(refresh.status, 200);
    // User-set fields untouched.
    assert.equal(refresh.body.bio,        'A hand-written bio that the user worked hard on.');
    assert.equal(refresh.body.birth_date, '1850');
    assert.equal(refresh.body.death_date, '1920');
    assert.equal(refresh.body.photo_path, userPhotoPath);
    // System metadata still tracks the latest OL match.
    assert.equal(refresh.body.ol_key, 'OL99999A');
    assert.ok(refresh.body.bio_fetched_at);
  });

  it('refresh fills missing fields without overwriting set ones', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Partial Fill Book', authors: ['Half Curated Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Pre-set bio + birth_date; leave death_date and photo blank.
    await req('PATCH', `/api/authors/${aid}`, {
      bio:        'User-written bio that stays.',
      birth_date: '1810',
    });

    stubFetch([
      {
        match: (u) => u.startsWith('https://openlibrary.org/search/authors.json'),
        respond: () => jsonResponse({ docs: [{ key: 'OL77777A', name: 'Half Curated Author' }] }),
      },
      {
        match: (u) => u === 'https://openlibrary.org/authors/OL77777A.json',
        respond: () => jsonResponse({
          bio:        'OL bio that should NOT replace the user bio.',
          birth_date: '1700',          // shouldn't replace the user's 1810
          death_date: 'July 4, 1888',  // SHOULD land with full precision
          photos:     [-1],            // OL has no photo → leaves photo_path null
        }),
      },
    ]);

    const refresh = await req('POST', `/api/authors/${aid}/refresh`);
    assert.equal(refresh.status, 200);
    assert.equal(refresh.body.bio,        'User-written bio that stays.');
    assert.equal(refresh.body.birth_date, '1810');
    assert.equal(refresh.body.death_date, '1888-07-04'); // filled from OL at full precision
    assert.equal(refresh.body.photo_path, null);
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
    // bio_fetched_at SHOULD bump on a miss so the row records that the
    // lookup happened; the user can still re-attempt via the manual
    // refresh button.
    assert.ok(refresh.body.bio_fetched_at, 'bio_fetched_at should bump on miss');
  });

  it('PATCH birth_date and death_date round-trip and validate format', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Dates Edit Book', authors: ['Dates Edit Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Year-only round-trips as text.
    const set = await req('PATCH', `/api/authors/${aid}`, { birth_date: '1724', death_date: '1793' });
    assert.equal(set.status, 200);
    assert.equal(set.body.birth_date, '1724');
    assert.equal(set.body.death_date, '1793');

    // Full dates round-trip with month/day intact.
    const full = await req('PATCH', `/api/authors/${aid}`, { birth_date: '1724-04-22', death_date: '1793-12-15' });
    assert.equal(full.status, 200);
    assert.equal(full.body.birth_date, '1724-04-22');
    assert.equal(full.body.death_date, '1793-12-15');

    // YYYY-MM partial dates round-trip too.
    const partial = await req('PATCH', `/api/authors/${aid}`, { birth_date: '1724-04' });
    assert.equal(partial.status, 200);
    assert.equal(partial.body.birth_date, '1724-04');

    // Numeric year accepted and stringified for backward-compat.
    const numeric = await req('PATCH', `/api/authors/${aid}`, { birth_date: 1800 });
    assert.equal(numeric.status, 200);
    assert.equal(numeric.body.birth_date, '1800');

    // Clear death (author still alive — common edit shape).
    const clr = await req('PATCH', `/api/authors/${aid}`, { death_date: null });
    assert.equal(clr.status, 200);
    assert.equal(clr.body.death_date, null);
    assert.equal(clr.body.birth_date, '1800', 'birth_date should survive a death_date clear');

    // BCE years are allowed.
    const bce = await req('PATCH', `/api/authors/${aid}`, { birth_date: '-428', death_date: '-348' });
    assert.equal(bce.status, 200);
    assert.equal(bce.body.birth_date, '-428');

    // Junk rejected.
    const junk = await req('PATCH', `/api/authors/${aid}`, { birth_date: 'nineteen' });
    assert.equal(junk.status, 400);

    // Malformed shape rejected.
    const bad = await req('PATCH', `/api/authors/${aid}`, { birth_date: '1938/07/18' });
    assert.equal(bad.status, 400);

    // Month/day out of range rejected.
    const badMonth = await req('PATCH', `/api/authors/${aid}`, { birth_date: '1938-13' });
    assert.equal(badMonth.status, 400);
    const badDay = await req('PATCH', `/api/authors/${aid}`, { birth_date: '1938-02-32' });
    assert.equal(badDay.status, 400);

    // Out-of-year-range rejected.
    const tooOld = await req('PATCH', `/api/authors/${aid}`, { birth_date: '-9999' });
    assert.equal(tooOld.status, 400);
    const tooFar = await req('PATCH', `/api/authors/${aid}`, { death_date: '3000' });
    assert.equal(tooFar.status, 400);
  });

  it('refresh preserves month/day when only the year is later edited', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Year Edit Book', authors: ['Year Edit Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Seed a full-precision date the way the client does after an OL refresh.
    await req('PATCH', `/api/authors/${aid}`, { birth_date: '1850-07-18' });
    const { body: pre } = await req('GET', `/api/authors/${aid}`);
    assert.equal(pre.birth_date, '1850-07-18');

    // The DatesPicker client-side replaces year only; the server just
    // stores whatever it gets. Simulate the client splice ("1851" + "-07-18").
    const yearOnlyEdit = await req('PATCH', `/api/authors/${aid}`, { birth_date: '1851-07-18' });
    assert.equal(yearOnlyEdit.body.birth_date, '1851-07-18');
  });

  it('PATCH bio persists the text and bumps bio_fetched_at', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Bio Edit Book', authors: ['Bio Edit Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Pre-edit: no bio, bio_fetched_at null.
    const { body: pre } = await req('GET', `/api/authors/${aid}`);
    assert.equal(pre.bio, null);
    assert.equal(pre.bio_fetched_at, null);

    const set = await req('PATCH', `/api/authors/${aid}`, { bio: '  A bio with leading whitespace.  ' });
    assert.equal(set.status, 200);
    assert.equal(set.body.bio, 'A bio with leading whitespace.', 'bio should be trimmed');
    assert.ok(set.body.bio_fetched_at, 'bio_fetched_at should bump when bio is edited');

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
    // No state was persisted, so bio_fetched_at stays null.
    const { body: after } = await req('GET', `/api/authors/${aid}`);
    assert.equal(after.bio_fetched_at, null);
  });

  it('photo/url retries once on a transient TypeError and succeeds on the second attempt', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Retry Photo Book', authors: ['Retry Photo Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    // Tiny valid JPEG, >1 KB so the placeholder filter doesn't apply.
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
    const jpegPadding = Buffer.alloc(2048, 0);
    const jpegEOI = Buffer.from([0xFF, 0xD9]);
    const jpeg = Buffer.concat([jpegHeader, jpegPadding, jpegEOI]);

    let calls = 0;
    stubFetch([
      {
        match: (u) => u.startsWith('https://covers.openlibrary.org/'),
        respond: () => {
          calls += 1;
          if (calls === 1) throw new TypeError('fetch failed');
          return new Response(jpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
        },
      },
    ]);

    const r = await req('POST', `/api/authors/${aid}/photo/url`, {
      url: 'https://covers.openlibrary.org/a/olid/OL1A-M.jpg?default=false',
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.photo_path?.startsWith('/uploads/authors/'));
    assert.equal(calls, 2);
  });

  it('photo/url surfaces the archive.org-specific message when both attempts hit a network failure', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Dead Photo Book', authors: ['Dead Photo Author'], fiction: true,
    });
    const aid = book.authors[0].id;

    let calls = 0;
    stubFetch([
      {
        match: (u) => u.startsWith('https://covers.openlibrary.org/'),
        respond: () => { calls += 1; throw new TypeError('fetch failed'); },
      },
    ]);

    const r = await req('POST', `/api/authors/${aid}/photo/url`, {
      url: 'https://covers.openlibrary.org/a/olid/OL1A-M.jpg?default=false',
    });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /archive\.org/);
    assert.equal(calls, 2);
  });

  it('search-ol retries once on a transient TypeError and surfaces the second attempt', async () => {
    // Mirrors the photo/url retry test — same shape applies to the JSON
    // fetch path used by searchAuthorsMulti. Without retry, the portrait
    // wizard surfaces a spurious 'Search failed' on flaky OL responses
    // (Jane Jacobs in particular intermittently 502s mid-session).
    let calls = 0;
    stubFetch([
      {
        match: (u) => u.startsWith('https://openlibrary.org/search/authors.json'),
        respond: () => {
          calls += 1;
          if (calls === 1) throw new TypeError('fetch failed');
          return jsonResponse({ docs: [
            { key: 'OL29371A', name: 'Jane Jacobs', birth_date: '4 May 1916', death_date: '25 April 2006' },
          ]});
        },
      },
    ]);

    const r = await req('GET', '/api/authors/search-ol?q=Jane+Jacobs');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
    assert.equal(r.body[0].name, 'Jane Jacobs');
    assert.equal(calls, 2);
  });
});

describe('authors — per-author default_sort', () => {
  let url;
  let close;
  before(async () => { const s = await createTestServer(); url = s.url; close = s.close; });
  after(() => close());
  async function req(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, body: data };
  }
  async function authorByline(name) {
    await req('POST', '/api/books', { title: `book by ${name} ${Math.random()}`, authors: [name] });
    const { body } = await req('GET', `/api/authors?q=${encodeURIComponent(name)}`);
    return body.find(a => a.name === name)?.id;
  }

  it('default_sort is null on a new author', async () => {
    const aid = await authorByline('Sort Author A');
    const { body } = await req('GET', `/api/authors/${aid}`);
    assert.equal(body.default_sort, null);
  });

  it('PATCH stores default_sort and round-trips on GET', async () => {
    const aid = await authorByline('Sort Author B');
    const { status, body } = await req('PATCH', `/api/authors/${aid}`, { default_sort: 'rating' });
    assert.equal(status, 200);
    assert.equal(body.default_sort, 'rating');
    const { body: after } = await req('GET', `/api/authors/${aid}`);
    assert.equal(after.default_sort, 'rating');
  });

  it('PATCH default_sort: null clears the memory', async () => {
    const aid = await authorByline('Sort Author C');
    await req('PATCH', `/api/authors/${aid}`, { default_sort: 'title' });
    const { body } = await req('PATCH', `/api/authors/${aid}`, { default_sort: null });
    assert.equal(body.default_sort, null);
  });

  it('PATCH rejects invalid default_sort', async () => {
    const aid = await authorByline('Sort Author D');
    const { status } = await req('PATCH', `/api/authors/${aid}`, { default_sort: 'nonsense' });
    assert.equal(status, 400);
  });

  it('PATCH rejects "random" (index-only sort, not a detail-page choice)', async () => {
    const aid = await authorByline('Sort Author E');
    const { status } = await req('PATCH', `/api/authors/${aid}`, { default_sort: 'random' });
    assert.equal(status, 400);
  });

  it('GET /api/authors/:id without ?sort= uses stored default_sort', async () => {
    const stem = 'Sort-FX-' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem} early`, authors: [`${stem} author`], year_published: 1900 });
    await req('POST', '/api/books', { title: `${stem} late`,  authors: [`${stem} author`], year_published: 2000 });
    const { body: idx } = await req('GET', `/api/authors?q=${encodeURIComponent(stem)}`);
    const aid = idx.find(a => a.name === `${stem} author`).id;
    // Set default_sort to title — would give early then late alphabetically.
    await req('PATCH', `/api/authors/${aid}`, { default_sort: 'title' });
    const { body } = await req('GET', `/api/authors/${aid}`);
    assert.equal(body.books[0].title, `${stem} early`);
    assert.equal(body.books[1].title, `${stem} late`);
    // Now switch default to reverse chronological; same books should flip.
    await req('PATCH', `/api/authors/${aid}`, { default_sort: 'year_published_desc' });
    const { body: after } = await req('GET', `/api/authors/${aid}`);
    assert.equal(after.books[0].year_published, 2000);
    assert.equal(after.books[1].year_published, 1900);
  });

  it('explicit ?sort= query overrides stored default_sort', async () => {
    const stem = 'Sort-Override-' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem} aaa`, authors: [`${stem} author`], year_published: 2000 });
    await req('POST', '/api/books', { title: `${stem} zzz`, authors: [`${stem} author`], year_published: 1900 });
    const { body: idx } = await req('GET', `/api/authors?q=${encodeURIComponent(stem)}`);
    const aid = idx.find(a => a.name === `${stem} author`).id;
    await req('PATCH', `/api/authors/${aid}`, { default_sort: 'year_published' });
    // Stored default would sort year_published asc → zzz (1900) before aaa (2000).
    // Explicit ?sort=title flips it: aaa before zzz.
    const { body } = await req('GET', `/api/authors/${aid}?sort=title`);
    assert.equal(body.books[0].title, `${stem} aaa`);
    assert.equal(body.books[1].title, `${stem} zzz`);
  });
});

describe('authors — index', () => {
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

  it('GET /api/authors returns every author with book_count + curation flags', async () => {
    // Two distinct authors, one with two books, one with one — confirms
    // book_count groups correctly and unrelated authors aren't double-
    // counted.
    const stem = 'idx' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-A`, authors: [`Prolific ${stem}`] });
    await req('POST', '/api/books', { title: `${stem}-B`, authors: [`Prolific ${stem}`] });
    await req('POST', '/api/books', { title: `${stem}-C`, authors: [`Onehit ${stem}`] });

    const { status, body } = await req('GET', '/api/authors');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));

    const prolific = body.find(a => a.name === `Prolific ${stem}`);
    const onehit   = body.find(a => a.name === `Onehit ${stem}`);
    assert.ok(prolific, 'two-book author should appear');
    assert.ok(onehit,   'one-book author should appear');
    assert.equal(prolific.book_count, 2);
    assert.equal(onehit.book_count,   1);
    // Curation flags are 0/1 ints from the SQLite boolean expression.
    assert.equal(prolific.has_bio,    0);
    assert.equal(prolific.has_photo,  0);
    assert.equal(prolific.has_ol_key, 0);
    assert.equal(prolific.birth_date, null);
    assert.equal(prolific.death_date, null);
  });

  it('GET /api/authors flips has_bio after a bio is set', async () => {
    const stem = 'biostate' + Math.random().toString(36).slice(2, 6);
    const { body: book } = await req('POST', '/api/books', { title: `${stem}-A`, authors: [`Author ${stem}`] });
    const aid = book.authors[0].id;
    let { body: idx } = await req('GET', '/api/authors');
    assert.equal(idx.find(a => a.id === aid).has_bio, 0);

    await req('PATCH', `/api/authors/${aid}`, { bio: 'a small bio' });
    ({ body: idx } = await req('GET', '/api/authors'));
    assert.equal(idx.find(a => a.id === aid).has_bio, 1);
  });

  it('GET /api/authors?q= filters by substring (case-insensitive) and caps results', async () => {
    const stem = 'qfilt' + Math.random().toString(36).slice(2, 6);
    // Two authors share the stem; one unrelated. The query should pick
    // up both stem-bearing names and skip the unrelated one.
    await req('POST', '/api/books', { title: `${stem}-A`, authors: [`Alice ${stem}`] });
    await req('POST', '/api/books', { title: `${stem}-B`, authors: [`Bob ${stem}`]   });
    await req('POST', '/api/books', { title: `${stem}-C`, authors: [`Carol unrelated ${Math.random().toString(36).slice(2, 6)}`] });

    // Case-insensitive: query in uppercase, names stored mixed-case.
    const { status, body } = await req('GET', `/api/authors?q=${stem.toUpperCase()}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    const names = body.map(a => a.name);
    assert.ok(names.includes(`Alice ${stem}`));
    assert.ok(names.includes(`Bob ${stem}`));
    assert.ok(!names.some(n => n.startsWith('Carol unrelated')));
    assert.ok(body.length <= 20, 'filtered response should be capped');
  });

  it('GET /api/authors?q= folds diacritics on both sides', async () => {
    // nrm()-based search: an ASCII query should match diacritic-bearing
    // stored names ("Stanislaw" → "Stanisław", "bohm" → "Böhm"), and a
    // query with the right diacritics should still match too. ł/đ are
    // included because NFD doesn't decompose them — they get an explicit
    // substitution in nrm().
    const stem = 'fold' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-A`, authors: [`Stanisław ${stem}`] });
    await req('POST', '/api/books', { title: `${stem}-B`, authors: [`Böhm ${stem}`] });

    const { body: a } = await req('GET', `/api/authors?q=Stanislaw+${stem}`);
    assert.ok(a.some(x => x.name === `Stanisław ${stem}`), 'ASCII "Stanislaw" should find stored "Stanisław"');

    const { body: b } = await req('GET', `/api/authors?q=bohm+${stem}`);
    assert.ok(b.some(x => x.name === `Böhm ${stem}`), 'ASCII "bohm" should find stored "Böhm"');

    const { body: c } = await req('GET', `/api/authors?q=${encodeURIComponent(`Stanisław ${stem}`)}`);
    assert.ok(c.some(x => x.name === `Stanisław ${stem}`), 'diacritic-bearing query still matches');
  });

  it('GET /api/authors?q= escapes SQL LIKE wildcards in user input', async () => {
    // A literal "%" in the query must not match every author. Verifies
    // the ESCAPE clause is doing its job.
    const stem = 'esc' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-A`, authors: [`Author ${stem}`] });
    const { body } = await req('GET', `/api/authors?q=${encodeURIComponent('%' + stem)}`);
    // No author name contains a literal "%", so the match set should be empty.
    assert.equal(body.length, 0);
  });

  it('GET /api/authors/random returns an author bylined on at least one book', async () => {
    const stem = 'rand' + Math.random().toString(36).slice(2, 6);
    const { body: book } = await req('POST', '/api/books', { title: `${stem}-A`, authors: [`Bylined ${stem}`] });
    const aid = book.authors[0].id;
    const { status, body } = await req('GET', '/api/authors/random');
    assert.equal(status, 200);
    assert.ok(Number.isInteger(body.id) && body.id >= 1);
    // The author we just created is one valid candidate among all
    // bylined authors in the DB — at minimum, the bylined index lookup
    // must succeed (404 only when there are zero bylined authors).
    const { status: rs } = await req('GET', `/api/authors/${body.id}`);
    assert.equal(rs, 200);
    // Sanity: our author appears in the unfiltered list.
    const { body: idx } = await req('GET', '/api/authors');
    assert.ok(idx.some(a => a.id === aid));
  });

  it('GET /api/authors is sorted by name (case-insensitive)', async () => {
    const stem = 'sort' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-A`, authors: [`zebra ${stem}`] });
    await req('POST', '/api/books', { title: `${stem}-B`, authors: [`Aardvark ${stem}`] });
    const { body } = await req('GET', '/api/authors');
    const aIdx = body.findIndex(a => a.name === `Aardvark ${stem}`);
    const zIdx = body.findIndex(a => a.name === `zebra ${stem}`);
    assert.ok(aIdx >= 0 && zIdx >= 0);
    assert.ok(aIdx < zIdx, 'lowercase z should sort after capital A');
  });

  it('GET /api/authors?missing=bio returns only bylined authors without a bio', async () => {
    // One author with no bio (bylined), one with a bio (bylined), one
    // with no bio but no books (dangling). Only the first should appear.
    const stem = 'misbio' + Math.random().toString(36).slice(2, 6);
    const { body: bookA } = await req('POST', '/api/books', {
      title: `${stem}-A`, authors: [`Nobio ${stem}`],
    });
    const { body: bookB } = await req('POST', '/api/books', {
      title: `${stem}-B`, authors: [`Withbio ${stem}`],
    });
    const withBioId = bookB.authors[0].id;
    await req('PATCH', `/api/authors/${withBioId}`, { bio: 'has a bio' });
    // Dangling author created via PATCH on a non-existent id is not
    // possible — instead create an author by POSTing a book then delete
    // the book. That leaves the author row but no book_authors row.
    const { body: bookC } = await req('POST', '/api/books', {
      title: `${stem}-C`, authors: [`Dangling ${stem}`],
    });
    await req('DELETE', `/api/books/${bookC.id}`);

    const { status, body } = await req('GET', '/api/authors?missing=bio&limit=200');
    assert.equal(status, 200);
    const names = body.map(a => a.name);
    assert.ok(names.includes(`Nobio ${stem}`),
      'bylined author without a bio should appear');
    assert.ok(!names.includes(`Withbio ${stem}`),
      'author with a bio should be excluded');
    assert.ok(!names.includes(`Dangling ${stem}`),
      'dangling author (no books) should be excluded by HAVING book_count > 0');
  });

  it('GET /api/authors?missing=gender / dates / portrait gate correctly', async () => {
    const stem = 'misgate' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-A`, authors: [`Gendered ${stem}`] });
    await req('POST', '/api/books', { title: `${stem}-B`, authors: [`Ungendered ${stem}`] });
    const { body: idx } = await req('GET', '/api/authors');
    const gendered = idx.find(a => a.name === `Gendered ${stem}`);
    await req('PATCH', `/api/authors/${gendered.id}`, { gender: 'female' });

    const { body: missingGender } = await req('GET', '/api/authors?missing=gender');
    const mgNames = missingGender.map(a => a.name);
    assert.ok(mgNames.includes(`Ungendered ${stem}`));
    assert.ok(!mgNames.includes(`Gendered ${stem}`));

    const { body: missingDates } = await req('GET', '/api/authors?missing=dates');
    const mdNames = missingDates.map(a => a.name);
    assert.ok(mdNames.includes(`Ungendered ${stem}`),
      'author with neither birth nor death should appear in missing=dates');

    const { body: missingPortrait } = await req('GET', '/api/authors?missing=portrait');
    const mpNames = missingPortrait.map(a => a.name);
    assert.ok(mpNames.includes(`Ungendered ${stem}`),
      'author with no photo_path should appear in missing=portrait');
  });

  it('GET /api/authors?missing=death_date requires birth set + >110y ago + no death', async () => {
    const stem = 'misdeath' + Math.random().toString(36).slice(2, 6);
    const now = new Date().getFullYear();
    const oldYear = now - 200; // safely > 110 years ago
    const youngYear = now - 50; // safely < 110 years ago
    // Old-birth, no death → SHOULD appear.
    const { body: a } = await req('POST', '/api/books', { title: `${stem}-A`, authors: [`OldNoDeath ${stem}`] });
    await req('PATCH', `/api/authors/${a.authors[0].id}`, { birth_date: String(oldYear) });
    // Young-birth, no death → should NOT appear (not implausibly alive).
    const { body: b } = await req('POST', '/api/books', { title: `${stem}-B`, authors: [`YoungNoDeath ${stem}`] });
    await req('PATCH', `/api/authors/${b.authors[0].id}`, { birth_date: String(youngYear) });
    // Old-birth + death already set → should NOT appear.
    const { body: c } = await req('POST', '/api/books', { title: `${stem}-C`, authors: [`OldWithDeath ${stem}`] });
    await req('PATCH', `/api/authors/${c.authors[0].id}`, { birth_date: String(oldYear), death_date: String(oldYear + 70) });

    const { body } = await req('GET', '/api/authors?missing=death_date');
    const names = body.map(x => x.name);
    assert.ok(names.includes(`OldNoDeath ${stem}`), 'old-birth no-death author should appear');
    assert.ok(!names.includes(`YoungNoDeath ${stem}`), 'young-birth no-death must NOT appear');
    assert.ok(!names.includes(`OldWithDeath ${stem}`), 'old-birth with death must NOT appear');
  });

  it('GET /api/authors?missing=bogus returns 400', async () => {
    const { status, body } = await req('GET', '/api/authors?missing=bogus');
    assert.equal(status, 400);
    assert.match(body.error, /Unknown missing filter/);
  });

  it('showcase=1 returns picks in rank order; PATCH validates 1–5', async () => {
    // POST a book to create an author, then PATCH the author into slots
    // 2 / 3 / 1 to test both rank ordering and parity with the books-side
    // PATCH validation (POST + PATCH must both reject out-of-range).
    const stem = 'sc' + Math.random().toString(36).slice(2, 6);
    const { body: ba } = await req('POST', '/api/books', { title: `${stem}-A`, authors: [`${stem} A`] });
    const { body: bb } = await req('POST', '/api/books', { title: `${stem}-B`, authors: [`${stem} B`] });
    const { body: bc } = await req('POST', '/api/books', { title: `${stem}-C`, authors: [`${stem} C`] });
    const aIdA = ba.authors[0].id;
    const aIdB = bb.authors[0].id;
    const aIdC = bc.authors[0].id;
    try {
      await req('PATCH', `/api/authors/${aIdA}`, { showcase_position: 2 });
      await req('PATCH', `/api/authors/${aIdB}`, { showcase_position: 3 });
      await req('PATCH', `/api/authors/${aIdC}`, { showcase_position: 1 });

      const { body: list } = await req('GET', '/api/authors?showcase=1');
      const ids = list.map(r => r.id);
      assert.deepEqual(ids, [aIdC, aIdA, aIdB], 'showcased authors in rank order');

      // Out-of-range guard — mirrors the books-side rule that POST and
      // PATCH must agree, since the column otherwise silently accepts
      // anything the row-level INSERT allows.
      const { status, body: err } = await req('PATCH', `/api/authors/${aIdA}`, { showcase_position: 6 });
      assert.equal(status, 400);
      assert.match(JSON.stringify(err), /showcase_position/);

      // Clearing the slot drops the author from the row.
      await req('PATCH', `/api/authors/${aIdA}`, { showcase_position: null });
      const { body: after } = await req('GET', '/api/authors?showcase=1');
      assert.deepEqual(after.map(r => r.id), [aIdC, aIdB], 'cleared slot drops out of showcase');
    } finally {
      // Cascade-deleting the books also tears down the per-author rows
      // since these are bare authors with no other books.
      await req('DELETE', `/api/books/${ba.id}`);
      await req('DELETE', `/api/books/${bb.id}`);
      await req('DELETE', `/api/books/${bc.id}`);
    }
  });
});
