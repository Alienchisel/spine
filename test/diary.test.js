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
  let close;
  let req;

  before(async () => {
    const server = await createTestServer();
    close = server.close;
    req = server.req;
  });

  after(() => close());

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

  describe('book-level + story-level dedup on the same date', () => {
    // Regression coverage for the double-count bug — when a user logs
    // both a book-level read (PATCH current_page) AND finishes one or
    // more stories on the same day, the reading_log gets a book-level
    // row AND story-level rows, all describing the same pages. The
    // sum naive .reduce() double-counted. New rule: per (book_id,
    // date), effective pages = MAX(book-level, sum-of-story-level);
    // book-level entries are tagged redundant when stories cover them.
    let bookId;
    let storyId;
    let baseline;

    before(async () => {
      // Baseline today's + now-relative page totals BEFORE this describe seeds
      // its dedup fixture, so the assertions below can check the DELTA the
      // fixture contributes (64 deduped, NOT 94 naive) rather than a whole-DB
      // absolute (== 94) that silently depends on every other test's activity
      // and the order describes run in. Capture today's date once and reuse it
      // so a midnight rollover between baseline and assertion can't desync them.
      const todayStr = new Date().toLocaleDateString('en-CA');
      const { body: base } = await req('GET', '/api/diary');
      baseline = {
        today: todayStr,
        day:   base.days.find(d => d.date === todayStr)?.pages_total ?? 0,
        week:  base.stats.thisWeek.pages,
        year:  base.stats.thisYear.pages,
      };

      const { body: book } = await req('POST', '/api/books', {
        title: 'Dedup Test', status: 'reading', format: 'physical', page_count: 100,
      });
      bookId = book.id;
      // Book-level reading_log row of 64 pages today.
      await req('PATCH', `/api/books/${bookId}`, { current_page: 64 });
      // Add a story covering pages 1-30, then finish it — creates a
      // story-level reading_log row of 30 pages today.
      const { body: story } = await req('POST', `/api/books/${bookId}/stories`, {
        title: 'Story A', position: 1, status: 'unread', page_start: 1, page_end: 30,
      });
      storyId = story.id;
      await req('PUT', `/api/books/${bookId}/stories/${storyId}`, {
        title: 'Story A', position: 1, status: 'finished', page_start: 1, page_end: 30,
      });
    });

    it('pages_total takes MAX(book-level, sum-of-stories), not sum', async () => {
      const { body } = await req('GET', '/api/diary');
      const day = body.days.find(d => d.entries.some(e => e.book_id === bookId));
      assert.ok(day, 'expected a day with the dedup-test book');
      const ourEntries = day.entries.filter(e => e.book_id === bookId);
      // Sanity: both rows present, raw entries sum to 64 + 30 = 94 (book-scoped
      // to our fixture, so this exact value is isolation-safe).
      assert.equal(ourEntries.length, 2);
      assert.equal(ourEntries.reduce((s, e) => s + e.pages_read, 0), 94);
      // Dedup: our fixture must lift today's pages_total by max(64, 30) = 64,
      // NOT the naive 64 + 30 = 94. Asserted as a delta over the pre-fixture
      // baseline so it can't be thrown off by other books logged today.
      assert.equal(day.pages_total - baseline.day, 64,
        'dedup fixture should add 64 (MAX), not 94 (naive SUM), to today\'s total');
    });

    it('tags the book-level row as redundant when stories cover it', async () => {
      const { body } = await req('GET', '/api/diary');
      const entries = body.days.flatMap(d => d.entries).filter(e => e.book_id === bookId);
      const bookLevel = entries.find(e => e.story_id == null);
      const storyLevel = entries.find(e => e.story_id != null);
      assert.ok(bookLevel && storyLevel, 'expected both row types');
      assert.equal(bookLevel.redundant, true, 'book-level row should be marked redundant');
      assert.equal(storyLevel.redundant, false, 'story-level row should not be redundant');
    });

    it('stats (week/month/year) dedup at SQL level too', async () => {
      // The dedup must also apply in the now-relative aggregates. Assert the
      // fixture's delta is 64 (deduped), not 94 (naive double-count of the
      // 30-page story on top of the 64-page book-level row) — as a delta over
      // the pre-fixture baseline so accumulated activity can't skew it.
      const { body } = await req('GET', '/api/diary');
      assert.equal(body.stats.thisWeek.pages - baseline.week, 64, 'week dedup: naive delta would be 94');
      assert.equal(body.stats.thisYear.pages - baseline.year, 64, 'year dedup: naive delta would be 94');
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
