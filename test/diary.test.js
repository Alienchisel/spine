// Coverage for routes/diary.js — empty/populated GET, year filtering,
// streak shape (locked in after the streak math was unified onto
// lib/stats/streaks.js), entry deletion, and joined book metadata.
//
// Streak math beyond "1 today" is tested in stats.test.js; here we just
// confirm diary plucks the right numbers out of calcStreaks().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('diary', () => {
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

  describe('GET /api/diary (empty)', () => {
    it('returns empty days and years with zero streaks', async () => {
      const { status, body } = await req('GET', '/api/diary');
      assert.equal(status, 200);
      assert.deepEqual(body.days, []);
      assert.deepEqual(body.years, []);
      assert.equal(body.stats.dayStreak, 0);
      assert.equal(body.stats.weekStreak, 0);
    });

    it('returns zero now-relative totals when there is no activity', async () => {
      const { body } = await req('GET', '/api/diary');
      assert.deepEqual(body.stats.thisWeek,  { pages: 0, minutes: 0 });
      assert.deepEqual(body.stats.thisMonth, { pages: 0, minutes: 0 });
      assert.deepEqual(body.stats.thisYear,  { pages: 0, minutes: 0 });
    });
  });

  describe('GET /api/diary with one day of activity', () => {
    let bookId;

    before(async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Diary Test', status: 'reading', format: 'physical', page_count: 200,
      });
      bookId = book.id;
      await req('PATCH', `/api/books/${bookId}`, { current_page: 30 });
    });

    it('lists today as a day with the entry', async () => {
      const { body } = await req('GET', '/api/diary');
      assert.equal(body.days.length, 1);
      const day = body.days[0];
      assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(day.entries.length, 1);
      const e = day.entries[0];
      assert.equal(e.book_id, bookId);
      assert.equal(e.title, 'Diary Test');
      assert.equal(e.pages_read, 30);
      assert.equal(e.format, 'physical');
      assert.equal(e.cover_path, null);
      assert.ok(typeof e.id === 'number');
      assert.deepEqual(e.authors, []);
    });

    it('pre-computes pages_total and minutes_total per day', async () => {
      // Single source of truth for the daily aggregation so the four
      // sites in Diary.jsx that previously each ran .reduce() over
      // entries don't drift when the rule changes.
      const { body } = await req('GET', '/api/diary');
      const day = body.days[0];
      assert.equal(day.pages_total, 30, 'matches the sum of entries.pages_read');
      assert.equal(day.minutes_total, 0, 'no minutes in this fixture');
    });

    it('includes the current year in the years list', async () => {
      const { body } = await req('GET', '/api/diary');
      const currentYear = new Date().getFullYear();
      assert.ok(body.years.includes(currentYear), `expected ${currentYear} in years list`);
    });

    it('reports dayStreak and weekStreak of 1 with today-only activity', async () => {
      const { body } = await req('GET', '/api/diary');
      assert.equal(body.stats.dayStreak, 1);
      assert.equal(body.stats.weekStreak, 1);
    });

    it('filters by year', async () => {
      const currentYear = new Date().getFullYear();
      const { body: thisYear } = await req('GET', `/api/diary?year=${currentYear}`);
      assert.ok(thisYear.days.length >= 1);
      const distantPast = currentYear - 50;
      const { body: empty } = await req('GET', `/api/diary?year=${distantPast}`);
      assert.deepEqual(empty.days, []);
    });

    it('ignores out-of-range or non-numeric year params', async () => {
      // Out-of-range falls back to "all years" — should still include today's entry.
      const { body: all } = await req('GET', '/api/diary?year=99999');
      assert.ok(all.days.length >= 1);
      const { body: garbage } = await req('GET', '/api/diary?year=abc');
      assert.ok(garbage.days.length >= 1);
    });

    it('reports now-relative totals regardless of the selected year', async () => {
      // The Diary Test fixture has 30 pages logged today via PATCH.
      // Selecting a past year filters the days array but must NOT zero out
      // thisWeek/thisMonth/thisYear — those track real-time activity.
      const { body } = await req('GET', '/api/diary?year=2000');
      assert.deepEqual(body.days, [], 'expected no entries when filtering by 2000');
      assert.ok(body.stats.thisWeek.pages  >= 30, `expected thisWeek.pages ≥ 30, got ${body.stats.thisWeek.pages}`);
      assert.ok(body.stats.thisMonth.pages >= 30, `expected thisMonth.pages ≥ 30, got ${body.stats.thisMonth.pages}`);
      assert.ok(body.stats.thisYear.pages  >= 30, `expected thisYear.pages ≥ 30, got ${body.stats.thisYear.pages}`);
    });
  });

  describe('finished flag', () => {
    // Local-date formatter mirrors how the server logs reading_log.date via
    // SQLite date('now','localtime'); using toISOString() would drift across
    // the UTC boundary.
    const localToday = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    it('flags entries on the day a book was finished', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Finished Today Book', status: 'reading', format: 'physical', page_count: 100,
      });
      // PATCH writes a reading_log row dated today.
      await req('PATCH', `/api/books/${book.id}`, { current_page: 50 });
      // POST /reads attaches a non-DNF finish event dated today, which the
      // diary's finished-flag CASE matches against the reading_log row.
      const today = localToday();
      await req('POST', `/api/books/${book.id}/reads`, {
        date_started: today, date_finished: today, did_not_finish: false,
      });

      const { body } = await req('GET', '/api/diary');
      const entries = body.days.flatMap(d => d.entries).filter(e => e.book_id === book.id);
      assert.ok(entries.length >= 1, 'expected at least one diary entry');
      assert.ok(entries.some(e => e.finished === true), 'expected a finished entry');
    });

    it('leaves the flag false on entries with no matching finish', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Just Progress Book', status: 'reading', format: 'physical', page_count: 100,
      });
      await req('PATCH', `/api/books/${book.id}`, { current_page: 20 });

      const { body } = await req('GET', '/api/diary');
      const entry = body.days.flatMap(d => d.entries).find(e => e.book_id === book.id);
      assert.ok(entry, 'expected a diary entry');
      assert.equal(entry.finished, false);
    });

    it('does not flag entries when the matching read is DNF', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'DNF Today Book', status: 'reading', format: 'physical', page_count: 100,
      });
      await req('PATCH', `/api/books/${book.id}`, { current_page: 40 });
      const today = localToday();
      await req('POST', `/api/books/${book.id}/reads`, {
        date_started: today, date_finished: today, did_not_finish: true,
      });

      const { body } = await req('GET', '/api/diary');
      const entry = body.days.flatMap(d => d.entries).find(e => e.book_id === book.id);
      assert.ok(entry, 'expected a diary entry');
      assert.equal(entry.finished, false, 'DNF reads should not flag as finished');
    });
  });

  describe('entry shape: joined book authors', () => {
    it('returns authors as an array of names in position order', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Authored Book',
        authors: ['Primary Writer', 'Co-Writer'],
        status: 'reading', format: 'physical', page_count: 100,
      });
      await req('PATCH', `/api/books/${book.id}`, { current_page: 5 });

      const { body } = await req('GET', '/api/diary');
      const entry = body.days.flatMap(d => d.entries).find(e => e.book_id === book.id);
      assert.ok(entry, 'expected to find diary entry for the authored book');
      assert.deepEqual(entry.authors, ['Primary Writer', 'Co-Writer']);
    });
  });

  describe('DELETE /api/diary/:id', () => {
    it('removes the entry', async () => {
      const { body: book } = await req('POST', '/api/books', {
        title: 'Delete Me', status: 'reading', format: 'physical', page_count: 100,
      });
      await req('PATCH', `/api/books/${book.id}`, { current_page: 10 });

      const { body: before } = await req('GET', '/api/diary');
      const entry = before.days.flatMap(d => d.entries).find(e => e.book_id === book.id);
      assert.ok(entry, 'expected entry to exist before delete');

      const del = await req('DELETE', `/api/diary/${entry.id}`);
      assert.equal(del.status, 204);

      const { body: after } = await req('GET', '/api/diary');
      const stillThere = after.days.some(d => d.entries.some(e => e.book_id === book.id));
      assert.equal(stillThere, false);
    });

    it('returns 400 for a non-integer id', async () => {
      const { status } = await req('DELETE', '/api/diary/abc');
      assert.equal(status, 400);
    });

    it('returns 404 for an unknown id', async () => {
      const { status } = await req('DELETE', '/api/diary/99999');
      assert.equal(status, 404);
    });
  });
});
