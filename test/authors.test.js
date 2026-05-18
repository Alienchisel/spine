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
});
