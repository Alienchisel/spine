import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('stats', () => {
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

  describe('GET /api/stats shape', () => {
    it('returns 200 with all expected top-level keys', async () => {
      const { status, body } = await req('GET', '/api/stats');
      assert.equal(status, 200);
      for (const key of ['totals', 'formats', 'fiction', 'ownedStatus', 'ratings',
        'pagesRead', 'minutesListened', 'byYear', 'topAuthors', 'topNarrators',
        'languages', 'streaks', 'todayPages', 'thisYearBooks', 'thisYearPages',
        'topTags', 'topSeries', 'avgPagesPerDay', 'avgMinutesPerDay',
        'avgDaysToFinish', 'inProgressPace', 'decadesPublished', 'records']) {
        assert.ok(key in body, `missing key: ${key}`);
      }
    });

    it('totals has required fields', async () => {
      const { body } = await req('GET', '/api/stats');
      for (const key of ['books', 'owned', 'previously_owned', 'never_owned', 'custom', 'reading', 'finished', 'unread', 'loved']) {
        assert.ok(key in body.totals, `totals missing: ${key}`);
      }
    });

    it('acquisitionSources buckets cover the expected lanes', async () => {
      // The donut on the Stats page is gated on this object existing and
      // having the five fixed bucket keys. Adding/renaming a bucket would
      // silently swallow a slice of the chart, so lock the contract.
      const { body } = await req('GET', '/api/stats');
      assert.ok(body.acquisitionSources, 'acquisitionSources missing');
      for (const key of ['kindle', 'audible', 'internet', 'amazon', 'other', 'unknown']) {
        assert.ok(key in body.acquisitionSources, `acquisitionSources missing: ${key}`);
      }
    });

    it('records has required book-record fields', async () => {
      const { body } = await req('GET', '/api/stats');
      for (const key of ['longestRead', 'shortestRead', 'longestAudiobook', 'oldestEdition', 'newestEdition', 'firstFinished', 'lastFinished', 'mostReread']) {
        assert.ok(key in body.records, `records missing: ${key}`);
      }
    });

    it('streaks has day/week/month sub-objects', async () => {
      const { body } = await req('GET', '/api/stats');
      assert.ok('current' in body.streaks.days && 'longest' in body.streaks.days);
      assert.ok('current' in body.streaks.weeks && 'longest' in body.streaks.weeks);
      assert.ok('current' in body.streaks.months && 'longest' in body.streaks.months);
    });
  });

  describe('GET /api/stats counts reflect data', () => {
    before(async () => {
      await req('POST', '/api/books', { title: 'Stats Finished A', status: 'finished', date_finished: '2024-06-01', page_count: 300, owned: true });
      await req('POST', '/api/books', { title: 'Stats Finished B', status: 'finished', date_finished: '2024-07-01', page_count: 100, owned: true });
      await req('POST', '/api/books', { title: 'Stats Reading',  status: 'reading', owned: true });
      await req('POST', '/api/books', { title: 'Stats Unread',   status: 'unread' });
      await req('POST', '/api/books', { title: 'Stats Author Book', status: 'finished', date_finished: '2023-01-01', authors: ['Test Stat Author'] });
      await req('POST', '/api/books', { title: 'Stats Author Book 2', status: 'finished', date_finished: '2023-02-01', authors: ['Test Stat Author'] });
    });

    it('totals.books counts all books', async () => {
      const { body: before } = await req('GET', '/api/stats');
      await req('POST', '/api/books', { title: 'Count Me' });
      const { body: after } = await req('GET', '/api/stats');
      assert.equal(after.totals.books, before.totals.books + 1);
    });

    it('totals.finished counts finished books', async () => {
      const { body } = await req('GET', '/api/stats');
      assert.ok(body.totals.finished >= 3, `expected >= 3 finished, got ${body.totals.finished}`);
    });

    it('byYear groups by date_finished year', async () => {
      const { body } = await req('GET', '/api/stats');
      const y2024 = body.byYear.find(r => r.year === '2024');
      assert.ok(y2024 && y2024.count >= 2, 'expected at least 2 books finished in 2024');
      const y2023 = body.byYear.find(r => r.year === '2023');
      assert.ok(y2023 && y2023.count >= 2, 'expected at least 2 books finished in 2023');
    });

    it('pagesRead reflects reading_log', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Pages Log Book' });
      const { body: before } = await req('GET', '/api/stats');
      await req('PATCH', `/api/books/${b.id}`, { current_page: 75 });
      const { body: after } = await req('GET', '/api/stats');
      assert.equal(after.pagesRead, before.pagesRead + 75);
    });

    it('minutesListened reflects reading_log', async () => {
      const { body: b } = await req('POST', '/api/books', { title: 'Minutes Log Book' });
      const { body: before } = await req('GET', '/api/stats');
      await req('PATCH', `/api/books/${b.id}`, { current_minutes: 90 });
      const { body: after } = await req('GET', '/api/stats');
      assert.equal(after.minutesListened, before.minutesListened + 90);
    });

    it('topAuthors includes author with multiple books', async () => {
      const { body } = await req('GET', '/api/stats');
      const entry = body.topAuthors.find(a => a.author === 'Test Stat Author');
      assert.ok(entry && entry.count >= 2, 'expected Test Stat Author with count >= 2');
    });

    it('records.firstFinished and records.longestRead are non-null', async () => {
      const { body } = await req('GET', '/api/stats');
      assert.notEqual(body.records.firstFinished, null);
      assert.notEqual(body.records.longestRead, null);
    });

    it('avgDaysToFinish reflects date_started → date_finished spans', async () => {
      await req('POST', '/api/books', {
        title: 'Span Book',
        status: 'finished',
        date_started: '2024-01-01',
        date_finished: '2024-01-21',
      });
      const { body } = await req('GET', '/api/stats');
      assert.ok(body.avgDaysToFinish != null && body.avgDaysToFinish > 0,
        `expected positive avgDaysToFinish, got ${body.avgDaysToFinish}`);
    });

    it('decadesPublished buckets by year_published, including BCE', async () => {
      await req('POST', '/api/books', { title: 'Modern', year_published: 1995 });
      await req('POST', '/api/books', { title: 'Iliad', year_published: -800, year_approximate: true });
      const { body } = await req('GET', '/api/stats');
      const modern = body.decadesPublished.find(d => d.decade === 1990);
      assert.ok(modern && modern.count >= 1, 'expected 1990s bucket with at least 1');
      const ancient = body.decadesPublished.find(d => d.decade === -800);
      assert.ok(ancient && ancient.count >= 1, 'expected -800 bucket with at least 1');
    });

    it('inProgressPace lists currently-reading books with progress fields', async () => {
      const { body: b } = await req('POST', '/api/books', {
        title: 'Pace Reader',
        status: 'reading',
        page_count: 400,
      });
      await req('PATCH', `/api/books/${b.id}`, { current_page: 100 });
      const { body } = await req('GET', '/api/stats');
      const entry = body.inProgressPace.find(p => p.id === b.id);
      assert.ok(entry, 'expected reading book in inProgressPace');
      assert.equal(entry.pct, 25);
      assert.ok('projected_days_left' in entry);
    });
  });
});
