// Workflow-level tests: each describe simulates a real user flow that crosses
// several endpoints. These guard the contracts between layers (e.g. progress
// PATCH → reading_log → diary, or status='finished' → read_count auto-bump),
// where single-endpoint tests would miss "forgot one layer" regressions.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('workflows', () => {
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

  // ── Workflow 1: Add book from lookup result ──
  describe('add book from lookup result', () => {
    it('persists every field the BookForm fills from a search result', async () => {
      // Mirrors the shape of api.searchBooks() + fetchBookDescription that
      // applyResult() in BookForm.jsx feeds into the form before submit.
      const lookup = {
        title: 'The Three-Body Problem',
        authors: ['Liu Cixin'],
        publisher: 'Tor Books',
        page_count: 400,
        isbn_10: '0765377063',
        isbn_13: '9780765377067',
        description: 'Set against the backdrop of the Cultural Revolution.',
      };

      const { status, body } = await req('POST', '/api/books', lookup);
      assert.equal(status, 201);
      assert.equal(body.title, lookup.title);
      assert.equal(body.publisher, lookup.publisher);
      assert.equal(body.page_count, lookup.page_count);
      assert.equal(body.isbn_10, lookup.isbn_10);
      assert.equal(body.isbn_13, lookup.isbn_13);
      assert.equal(body.description, lookup.description);
      assert.equal(body.authors.length, 1);
      assert.equal(body.authors[0].name, 'Liu Cixin');

      // Round-trip via GET so we know the values survived the write/read cycle.
      const { body: roundtrip } = await req('GET', `/api/books/${body.id}`);
      assert.equal(roundtrip.title, lookup.title);
      assert.equal(roundtrip.publisher, lookup.publisher);
      assert.equal(roundtrip.page_count, lookup.page_count);
      assert.equal(roundtrip.isbn_13, lookup.isbn_13);
      assert.equal(roundtrip.authors[0].name, 'Liu Cixin');
    });
  });

  // ── Workflow 2: Add book to shelf, move it, unshelf it ──
  describe('shelf placement lifecycle', () => {
    let unitAId, unitBId, shelfAId, shelfBId;

    before(async () => {
      const { body: b }  = await req('POST', '/api/shelf/buildings', { name: 'Workflow Bldg' });
      const { body: r }  = await req('POST', '/api/shelf/rooms',     { building_id: b.id, name: 'Workflow Room' });
      const { body: u1 } = await req('POST', '/api/shelf/units',     { room_id: r.id, name: 'Unit A' });
      const { body: u2 } = await req('POST', '/api/shelf/units',     { room_id: r.id, name: 'Unit B' });
      const { body: s1 } = await req('POST', '/api/shelf/shelves',   { unit_id: u1.id, label: '1' });
      const { body: s2 } = await req('POST', '/api/shelf/shelves',   { unit_id: u2.id, label: '1' });
      unitAId  = u1.id; unitBId  = u2.id;
      shelfAId = s1.id; shelfBId = s2.id;
    });

    it('places a book on a shelf, moves it, then unshelves it', async () => {
      // Place on shelf A.
      const { body: book } = await req('POST', '/api/books', {
        title: 'Mobile Book', shelf_id: shelfAId, owned: true, format: 'physical',
      });
      assert.equal(book.shelf_id, shelfAId);
      assert.equal(book.unit_id, null);

      // Move to shelf B (different unit).
      const { body: moved } = await req('PUT', `/api/books/${book.id}`, {
        ...book, shelf_id: shelfBId, tags: [],
      });
      assert.equal(moved.shelf_id, shelfBId);

      // Step up: assign to a unit only (less specific than a shelf).
      const { body: atUnit } = await req('PUT', `/api/books/${book.id}`, {
        ...moved, shelf_id: null, unit_id: unitBId, tags: [],
      });
      assert.equal(atUnit.shelf_id, null);
      assert.equal(atUnit.unit_id, unitBId);
      assert.equal(atUnit.room_id, null);

      // Unshelf entirely — all four location fields cleared.
      const { body: unshelfed } = await req('PUT', `/api/books/${book.id}`, {
        ...atUnit, shelf_id: null, building_id: null, room_id: null, unit_id: null, tags: [],
      });
      assert.equal(unshelfed.shelf_id,    null);
      assert.equal(unshelfed.unit_id,     null);
      assert.equal(unshelfed.room_id,     null);
      assert.equal(unshelfed.building_id, null);
    });

    it('moving from unit A to unit A is a no-op (idempotent)', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Stationary', unit_id: unitAId, owned: true, format: 'physical',
      });
      const { body: again } = await req('PUT', `/api/books/${book.id}`, {
        ...book, unit_id: unitAId, tags: [],
      });
      assert.equal(again.unit_id, unitAId);
    });
  });

  // ── Workflow 3: Mark progress to completion ──
  describe('reading progress to completion', () => {
    it('logs progress incrementally then transitions to finished with read_count bump', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'A Long Read', status: 'reading', format: 'physical', page_count: 200,
      });
      assert.equal(book.read_count, 0);

      // Two PATCH increments on the same day.
      const { body: p1 } = await req('PATCH', `/api/books/${book.id}`, { current_page: 50 });
      assert.equal(p1.current_page, 50);

      const { body: p2 } = await req('PATCH', `/api/books/${book.id}`, { current_page: 120 });
      assert.equal(p2.current_page, 120);

      // reading_log: single row for today, accumulated 120 pages
      // (50 from the first PATCH + 70 delta from the second).
      const { body: log } = await req('GET', `/api/books/${book.id}/log`);
      assert.equal(log.length, 1);
      assert.equal(log[0].pages_read, 120);

      // Finish transition: status → 'finished', read_count auto-bumps to 1.
      // We deliberately leave read_count alone in the payload so the manual-
      // override path is not taken (see lib/books/repository.js comment).
      const today = new Date().toISOString().slice(0, 10);
      const { body: finished } = await req('PUT', `/api/books/${book.id}`, {
        ...p2,
        status: 'finished',
        date_finished: today,
        tags: [],
      });
      assert.equal(finished.status, 'finished');
      assert.equal(finished.read_count, 1);
      assert.equal(finished.date_finished, today);
    });
  });

  // ── Workflow 4: Create list, add books, reorder, remove, delete ──
  describe('list lifecycle', () => {
    it('creates a list, adds three books, reorders, removes one, then deletes the list', async () => {
      const { status: cs, body: list } = await req('POST', '/api/lists', { name: 'Summer reads' });
      assert.equal(cs, 201);
      assert.equal(list.name, 'Summer reads');

      const { body: a } = await req('POST', '/api/books', { title: 'Alpha' });
      const { body: b } = await req('POST', '/api/books', { title: 'Bravo' });
      const { body: c } = await req('POST', '/api/books', { title: 'Charlie' });

      await req('POST', `/api/lists/${list.id}/books`, { book_id: a.id });
      await req('POST', `/api/lists/${list.id}/books`, { book_id: b.id });
      await req('POST', `/api/lists/${list.id}/books`, { book_id: c.id });

      // Insertion order preserved.
      const { body: l1 } = await req('GET', `/api/lists/${list.id}`);
      assert.deepEqual(l1.books.map(x => x.id), [a.id, b.id, c.id]);

      // Reverse via PUT /order.
      await req('PUT', `/api/lists/${list.id}/order`, { ids: [c.id, b.id, a.id] });
      const { body: l2 } = await req('GET', `/api/lists/${list.id}`);
      assert.deepEqual(l2.books.map(x => x.id), [c.id, b.id, a.id]);

      // Remove the middle book.
      const { status: rs } = await req('DELETE', `/api/lists/${list.id}/books/${b.id}`);
      assert.equal(rs, 204);
      const { body: l3 } = await req('GET', `/api/lists/${list.id}`);
      assert.deepEqual(l3.books.map(x => x.id), [c.id, a.id]);

      // Delete the list — and confirm GET 404s afterwards.
      const { status: ds } = await req('DELETE', `/api/lists/${list.id}`);
      assert.equal(ds, 204);
      const { status: gone } = await req('GET', `/api/lists/${list.id}`);
      assert.equal(gone, 404);
    });
  });

  // ── Workflow 5: Read history is decoupled from read_count ──
  describe('read history is decoupled from read_count', () => {
    it('lets reads rows accumulate without touching books.read_count', async () => {
      const { body: book } = await req('POST', '/api/books', { title: 'Re-read favourite' });
      assert.equal(book.read_count, 0);

      await req('POST', `/api/books/${book.id}/reads`, {
        date_started: '2024-01-01', date_finished: '2024-01-15',
      });
      await req('POST', `/api/books/${book.id}/reads`, {
        date_started: '2025-03-01', date_finished: '2025-03-20',
      });

      const { body: reads } = await req('GET', `/api/books/${book.id}/reads`);
      assert.equal(reads.length, 2);

      // Phase 4 invariant: read_count is not derived from reads row count.
      const { body: refetched } = await req('GET', `/api/books/${book.id}`);
      assert.equal(refetched.read_count, 0);

      // Manual read_count override via PUT must still work — that's the
      // documented escape hatch for retroactive imports.
      const { body: bumped } = await req('PUT', `/api/books/${book.id}`, {
        ...refetched, read_count: 5, tags: [],
      });
      assert.equal(bumped.read_count, 5);

      // Manual override must not touch the reads rows.
      const { body: stillTwo } = await req('GET', `/api/books/${book.id}/reads`);
      assert.equal(stillTwo.length, 2);
    });
  });

  // ── Workflow 6: Diary entries via progress logging ──
  describe('diary entries via progress logging', () => {
    it('shows reading_log entries in the diary and supports deletion', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Diary Book', status: 'reading', format: 'physical', page_count: 100,
      });

      await req('PATCH', `/api/books/${book.id}`, { current_page: 30 });

      // Diary should contain at least one day with our entry.
      const { body: diary1 } = await req('GET', '/api/diary');
      const dayWithBook = diary1.days.find(d => d.entries.some(e => e.book_id === book.id));
      assert.ok(dayWithBook, 'expected diary to include the new entry');
      const entry = dayWithBook.entries.find(e => e.book_id === book.id);
      assert.equal(entry.pages_read, 30);
      assert.equal(entry.title, 'Diary Book');

      // Delete the entry by its reading_log row id.
      const { status: ds } = await req('DELETE', `/api/diary/${entry.id}`);
      assert.equal(ds, 204);

      // Verify the entry is gone from subsequent diary fetches.
      const { body: diary2 } = await req('GET', '/api/diary');
      const stillThere = diary2.days.some(d => d.entries.some(e => e.book_id === book.id));
      assert.equal(stillThere, false);

      // Deleting an already-gone entry returns 404.
      const { status: again } = await req('DELETE', `/api/diary/${entry.id}`);
      assert.equal(again, 404);
    });
  });
});
