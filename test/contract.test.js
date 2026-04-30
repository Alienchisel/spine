/**
 * Book contract test: exercises every supported field through the full
 * create → fetch → update → fetch lifecycle and asserts the expected
 * normalized shape at each step.
 *
 * Key normalizations under test:
 *   - title whitespace trimmed via t()
 *   - isbn_10 / isbn_13 hyphens stripped
 *   - asin uppercased
 *   - language defaults to 'English'
 *   - owned/previously_owned mutual exclusivity (owned wins on POST)
 *   - fiction boolean → 0/1/null
 *   - year_approximate boolean → 0/1
 *   - is_stub auto-cleared to 0 when title + authors both present on PUT
 *   - shelf_id set → building_id/room_id/unit_id stored as null
 *   - unit_id only (no shelf_id, no room_id) → unit_id stored
 *   - cover_path /uploads/{file} round-trips correctly
 *   - read_count incremented by status → 'finished' transition
 *   - tags/authors/narrators/translators fully replaced on PUT
 *   - virtual tags are field-derived and respect format-specific gates
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('book contract: full field round-trip', () => {
  let url;
  let close;
  let buildingId, roomId, unitId, shelfId;
  let bookId;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;

    const { body: b } = await req('POST', '/api/shelf/buildings', { name: 'Contract Building' });
    buildingId = b.id;
    const { body: r } = await req('POST', '/api/shelf/rooms', { building_id: buildingId, name: 'Contract Room' });
    roomId = r.id;
    const { body: u } = await req('POST', '/api/shelf/units', { room_id: roomId, name: 'Contract Unit' });
    unitId = u.id;
    const { body: s } = await req('POST', '/api/shelf/shelves', { unit_id: unitId, label: 'A1' });
    shelfId = s.id;
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

  // ── Step 1: POST ────────────────────────────────────────────────────────────

  it('POST with every supported field returns 201 with correct normalized shape', async () => {
    const { status, body } = await req('POST', '/api/books', {
      title:             '  Moby-Dick  ',     // whitespace → trimmed
      authors:           ['Herman Melville'],
      narrators:         ['Frank Muller'],
      translators:       [],
      tags:              ['classic', 'American'],
      status:            'reading',
      owned:             true,
      previously_owned:  false,               // owned wins on conflict anyway
      is_custom:         false,
      is_stub:           true,                // POST stores as-is; PUT auto-clears
      loved:             false,
      fiction:           true,                // → 1
      source_type:       'primary',
      rating:            4.5,
      date_started:      '2024-03-01',
      date_finished:     null,
      acquisition_source:'Amazon',
      acquisition_date:  '2024-02',           // partial date: YYYY-MM
      format:            'physical',
      binding:           'hardcover',
      condition:         'fine',
      description:       'A whale of a tale.',
      notes:             'First edition copy.',
      review:            null,
      page_count:        720,                 // ≥ 500 → virtual tag 'Long'
      duration_minutes:  null,
      publisher:         'Penguin Classics',
      series:            'American Classics',
      series_number:     3,
      isbn_10:           '0-14-243723-1',     // hyphens → '0142437231'
      isbn_13:           '978-0-14-243723-0', // hyphens → '9780142437230'
      asin:              'b002ri9iy6',         // lowercase → 'B002RI9IY6'
      language:          'English',
      original_language: 'English',
      year_published:    1851,
      year_approximate:  false,               // → 0
      year_edition:      2003,
      abridged:          false,               // → 0
      shelf_id:          shelfId,             // clears building/room/unit_id
      cover_path:        '/uploads/1700000000000-mobydick.webp',
    });

    assert.equal(status, 201);
    bookId = body.id;
    assert.ok(bookId > 0);

    // String normalizations
    assert.equal(body.title, 'Moby-Dick');
    assert.equal(body.isbn_10, '0142437231');
    assert.equal(body.isbn_13, '9780142437230');
    assert.equal(body.asin, 'B002RI9IY6');

    // Status and read state
    assert.equal(body.status, 'reading');
    assert.equal(body.read_count, 0);

    // Boolean flags → integers
    assert.equal(body.owned, 1);
    assert.equal(body.previously_owned, 0);
    assert.equal(body.is_custom, 0);
    assert.equal(body.is_stub, 1);            // POST stores as-is
    assert.equal(body.loved, 0);
    assert.equal(body.fiction, 1);
    assert.equal(body.year_approximate, 0);
    assert.equal(body.abridged, 0);

    // Scalar fields
    assert.equal(body.source_type, 'primary');
    assert.equal(body.rating, 4.5);
    assert.equal(body.date_started, '2024-03-01');
    assert.equal(body.date_finished, null);
    assert.equal(body.acquisition_source, 'Amazon');
    assert.equal(body.acquisition_date, '2024-02');
    assert.equal(body.format, 'physical');
    assert.equal(body.binding, 'hardcover');
    assert.equal(body.condition, 'fine');
    assert.equal(body.description, 'A whale of a tale.');
    assert.equal(body.notes, 'First edition copy.');
    assert.equal(body.review, null);
    assert.equal(body.page_count, 720);
    assert.equal(body.duration_minutes, null);
    assert.equal(body.publisher, 'Penguin Classics');
    assert.equal(body.series, 'American Classics');
    assert.equal(body.series_number, 3);
    assert.equal(body.language, 'English');
    assert.equal(body.original_language, 'English');
    assert.deepEqual(body.translators, []);
    assert.equal(body.year_published, 1851);
    assert.equal(body.year_edition, 2003);

    // Location: shelf_id wins → building/room/unit stored as null
    assert.equal(body.shelf_id, shelfId);
    assert.equal(body.building_id, null);
    assert.equal(body.room_id, null);
    assert.equal(body.unit_id, null);

    // Cover path round-trip
    assert.equal(body.cover_path, '/uploads/1700000000000-mobydick.webp');

    // Relation arrays
    assert.deepEqual(body.authors.map(a => a.name), ['Herman Melville']);
    assert.deepEqual(body.narrators.map(n => n.name), ['Frank Muller']);
    assert.ok(body.tags.some(t => t.name === 'classic'));
    assert.ok(body.tags.some(t => t.name === 'American'));
    // Virtual tag: page_count 720 ≥ 500
    assert.ok(body.tags.some(t => t.name === 'Long' && t.virtual));
  });

  // ── Step 2: GET after POST ──────────────────────────────────────────────────

  it('GET after POST returns same normalized shape', async () => {
    const { status, body } = await req('GET', `/api/books/${bookId}`);
    assert.equal(status, 200);
    assert.equal(body.title, 'Moby-Dick');
    assert.equal(body.isbn_10, '0142437231');
    assert.equal(body.isbn_13, '9780142437230');
    assert.equal(body.asin, 'B002RI9IY6');
    assert.equal(body.owned, 1);
    assert.equal(body.fiction, 1);
    assert.equal(body.is_stub, 1);
    assert.equal(body.year_approximate, 0);
    assert.equal(body.shelf_id, shelfId);
    assert.equal(body.building_id, null);
    assert.equal(body.cover_path, '/uploads/1700000000000-mobydick.webp');
    assert.deepEqual(body.authors.map(a => a.name), ['Herman Melville']);
    assert.deepEqual(body.narrators.map(n => n.name), ['Frank Muller']);
    assert.ok(body.tags.some(t => t.name === 'classic'));
    assert.ok(body.tags.some(t => t.name === 'Long' && t.virtual));
  });

  // ── Step 3: PUT ─────────────────────────────────────────────────────────────

  it('PUT with every supported field returns updated normalized shape', async () => {
    const { status, body } = await req('PUT', `/api/books/${bookId}`, {
      title:             'Billy Budd',
      authors:           ['Herman Melville', 'Raymond Weaver'],
      narrators:         ['Simon Vance'],
      translators:       ['Constance Garnett'],
      tags:              ['classic', 'novella'],
      status:            'finished',          // triggers read_count +1
      owned:             false,
      previously_owned:  true,
      is_custom:         true,
      is_stub:           true,                // auto-cleared: title + authors present → 0
      loved:             true,
      fiction:           false,               // → 0 (was 1)
      source_type:       'secondary',
      rating:            3.5,
      date_started:      '2024-04-01',
      date_finished:     '2024-04-10',
      acquisition_source:'Library',
      acquisition_date:  '2024',              // year-only partial date
      format:            'audiobook',
      binding:           null,                // cleared
      condition:         null,                // cleared
      description:       'A sailor story.',
      notes:             null,                // cleared via t()
      review:            'Short but powerful.',
      page_count:        null,                // cleared
      duration_minutes:  180,
      publisher:         'Signet',
      series:            null,                // cleared
      series_number:     null,                // cleared
      isbn_10:           '0-14-018045-X',    // trailing X + hyphens → '014018045X'
      isbn_13:           null,                // cleared
      asin:              null,                // cleared
      language:          'English',
      original_language: null,                // cleared
      year_published:    1924,
      year_approximate:  true,               // → 1 (was 0)
      year_edition:      1961,               // physical-format gate means Vintage does NOT fire here (audiobook)
      abridged:          true,               // → 1 (was 0)
      shelf_id:          null,               // remove shelf
      unit_id:           unitId,             // unit_id stored (no shelf_id, no room_id)
      cover_path:        '/uploads/1700000001111-billybudd.webp',
    });

    assert.equal(status, 200);

    // String normalizations
    assert.equal(body.title, 'Billy Budd');
    assert.equal(body.isbn_10, '014018045X');
    assert.equal(body.isbn_13, null);
    assert.equal(body.asin, null);

    // read_count incremented by finish transition
    assert.equal(body.status, 'finished');
    assert.equal(body.read_count, 1);

    // Boolean flags
    assert.equal(body.owned, 0);
    assert.equal(body.previously_owned, 1);
    assert.equal(body.is_custom, 1);
    assert.equal(body.is_stub, 0);            // auto-cleared: title + authors present
    assert.equal(body.loved, 1);
    assert.equal(body.fiction, 0);            // false → 0
    assert.equal(body.year_approximate, 1);   // true → 1
    assert.equal(body.abridged, 1);           // true → 1

    // Scalar fields
    assert.equal(body.source_type, 'secondary');
    assert.equal(body.rating, 3.5);
    assert.equal(body.date_started, '2024-04-01');
    assert.equal(body.date_finished, '2024-04-10');
    assert.equal(body.acquisition_source, 'Library');
    assert.equal(body.acquisition_date, '2024');
    assert.equal(body.format, 'audiobook');
    assert.equal(body.binding, null);
    assert.equal(body.condition, null);
    assert.equal(body.description, 'A sailor story.');
    assert.equal(body.notes, null);
    assert.equal(body.review, 'Short but powerful.');
    assert.equal(body.page_count, null);
    assert.equal(body.duration_minutes, 180);
    assert.equal(body.publisher, 'Signet');
    assert.equal(body.series, null);
    assert.equal(body.series_number, null);
    assert.equal(body.language, 'English');
    assert.equal(body.original_language, null);
    assert.deepEqual(body.translators.map(t => t.name), ['Constance Garnett']);
    assert.equal(body.year_published, 1924);
    assert.equal(body.year_edition, 1961);

    // Location: no shelf_id → unit_id stored; building/room cleared
    assert.equal(body.shelf_id, null);
    assert.equal(body.unit_id, unitId);
    assert.equal(body.room_id, null);
    assert.equal(body.building_id, null);

    // Cover path round-trip
    assert.equal(body.cover_path, '/uploads/1700000001111-billybudd.webp');

    // Relations replaced
    assert.deepEqual(body.authors.map(a => a.name), ['Herman Melville', 'Raymond Weaver']);
    assert.deepEqual(body.narrators.map(n => n.name), ['Simon Vance']);
    assert.ok(!body.tags.some(t => t.name === 'American'));   // removed
    assert.ok(body.tags.some(t => t.name === 'classic'));
    assert.ok(body.tags.some(t => t.name === 'novella'));
    // Vintage does NOT fire: it requires format='physical' to signal a
    // physically older copy, and this fixture is an audiobook.
    assert.ok(!body.tags.some(t => t.name === 'Vintage'));
    // Real tags only: classic + novella
    assert.equal(body.tags.filter(t => !t.virtual).length, 2);
  });

  // ── Step 4: GET after PUT ───────────────────────────────────────────────────

  it('GET after PUT returns persisted normalized shape', async () => {
    const { status, body } = await req('GET', `/api/books/${bookId}`);
    assert.equal(status, 200);

    assert.equal(body.title, 'Billy Budd');
    assert.equal(body.isbn_10, '014018045X');
    assert.equal(body.isbn_13, null);
    assert.equal(body.asin, null);
    assert.equal(body.status, 'finished');
    assert.equal(body.read_count, 1);
    assert.equal(body.owned, 0);
    assert.equal(body.previously_owned, 1);
    assert.equal(body.is_custom, 1);
    assert.equal(body.is_stub, 0);
    assert.equal(body.loved, 1);
    assert.equal(body.fiction, 0);
    assert.equal(body.year_approximate, 1);
    assert.equal(body.abridged, 1);
    assert.equal(body.rating, 3.5);
    assert.equal(body.page_count, null);
    assert.equal(body.duration_minutes, 180);
    assert.equal(body.series, null);
    assert.equal(body.series_number, null);
    assert.equal(body.shelf_id, null);
    assert.equal(body.unit_id, unitId);
    assert.equal(body.cover_path, '/uploads/1700000001111-billybudd.webp');
    assert.deepEqual(body.authors.map(a => a.name), ['Herman Melville', 'Raymond Weaver']);
    assert.deepEqual(body.narrators.map(n => n.name), ['Simon Vance']);
    assert.equal(body.tags.filter(t => !t.virtual).length, 2);
    // Vintage gated to format='physical'; this fixture is an audiobook, so absent.
    assert.ok(!body.tags.some(t => t.name === 'Vintage'));
  });

  // ── Edge: language defaults ─────────────────────────────────────────────────

  it('language defaults to English when omitted on POST', async () => {
    const { body } = await req('POST', '/api/books', { title: 'No Language' });
    assert.equal(body.language, 'English');
  });

  it('fiction null is stored and returned as null (not 0)', async () => {
    const { body } = await req('POST', '/api/books', { title: 'Unknown Fiction' });
    assert.equal(body.fiction, null);
  });
});
