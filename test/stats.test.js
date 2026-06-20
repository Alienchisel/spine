import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('stats', () => {
  let url;
  let close;
  let req;

  before(async () => {
    const server = await createTestServer();
    url = server.url;
    close = server.close;
    req = server.req;
  });

  after(() => close());

  describe('GET /api/stats shape', () => {
    it('returns 200 with all expected top-level keys', async () => {
      const { status, body } = await req('GET', '/api/stats');
      assert.equal(status, 200);
      for (const key of ['totals', 'formats', 'fiction', 'ownedStatus', 'ratings',
        'pagesRead', 'minutesListened', 'byYear', 'acquiredByYear', 'topAuthors', 'topNarrators',
        'languages', 'authorsByGender', 'streaks', 'todayPages', 'thisYearBooks', 'thisYearPages',
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

    it('authorsByGender has the four fixed bucket keys', async () => {
      // The Stats page's "Authors by gender" section is gated on these
      // four keys existing. Renaming or dropping one would silently make
      // its slice invisible, so lock the contract.
      const { body } = await req('GET', '/api/stats');
      assert.ok(body.authorsByGender, 'authorsByGender missing');
      for (const key of ['male', 'female', 'other', 'unassigned']) {
        assert.ok(key in body.authorsByGender, `authorsByGender missing: ${key}`);
        assert.equal(typeof body.authorsByGender[key], 'number', `${key} should be a number`);
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
      for (const key of ['longestReadPhysical', 'shortestReadPhysical', 'longestReadDigital', 'shortestReadDigital', 'longestReadAudiobook', 'shortestReadAudiobook', 'longestLibraryPhysical', 'shortestLibraryPhysical', 'longestLibraryDigital', 'shortestLibraryDigital', 'longestLibraryAudiobook', 'shortestLibraryAudiobook', 'oldestEdition', 'newestEdition', 'firstFinished', 'lastFinished', 'mostReread']) {
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
      // format='physical' on the page-count fixtures so the format-split
      // longest/shortest read records pick them up — production data is
      // always format-set, the tests should mirror that shape.
      await req('POST', '/api/books', { title: 'Stats Finished A', status: 'finished', date_finished: '2024-06-01', page_count: 300, owned: true, format: 'physical' });
      await req('POST', '/api/books', { title: 'Stats Finished B', status: 'finished', date_finished: '2024-07-01', page_count: 100, owned: true, format: 'physical' });
      await req('POST', '/api/books', { title: 'Stats Reading',  status: 'reading', owned: true });
      await req('POST', '/api/books', { title: 'Stats Unread',   status: 'unread' });
      await req('POST', '/api/books', { title: 'Stats Author Book', status: 'finished', date_finished: '2023-01-01', authors: ['Test Stat Author'], format: 'physical', page_count: 250 });
      await req('POST', '/api/books', { title: 'Stats Author Book 2', status: 'finished', date_finished: '2023-02-01', authors: ['Test Stat Author'], format: 'physical', page_count: 200 });
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

    it('acquiredByYear groups by the acquisition_date year prefix', async () => {
      // Seed two books in distinct years (one with a YYYY-MM-DD acquisition
      // and one with a year-only partial) so the substr(...,1,4) grouping
      // is exercised for both shapes. owned: true is required —
      // repository.js nulls acquisition_date on unowned books.
      await req('POST', '/api/books', {
        title: 'Acquired Full 2031', acquisition_date: '2031-04-15', owned: true,
      });
      await req('POST', '/api/books', {
        title: 'Acquired YearOnly 2032', acquisition_date: '2032', owned: true,
      });
      const { body } = await req('GET', '/api/stats');
      const y2031 = body.acquiredByYear.find(r => r.year === '2031');
      const y2032 = body.acquiredByYear.find(r => r.year === '2032');
      assert.ok(y2031 && y2031.count >= 1, 'expected at least 1 acquisition in 2031');
      assert.ok(y2032 && y2032.count >= 1, 'expected at least 1 acquisition in 2032 (year-only date)');
      // Sorted DESC by year — most recent at the top.
      const years = body.acquiredByYear.map(r => r.year);
      for (let i = 1; i < years.length; i++) {
        assert.ok(years[i - 1] >= years[i], `acquiredByYear should sort DESC: got ${years.join(', ')}`);
      }
    });

    it('pagesRead sums page_count of finished non-audiobooks', async () => {
      const { body: before } = await req('GET', '/api/stats');
      await req('POST', '/api/books', {
        title: 'Pages Read Book',
        page_count: 250,
        format: 'physical',
        status: 'finished',
        date_finished: '2024-06-01',
      });
      const { body: after } = await req('GET', '/api/stats');
      assert.equal(after.pagesRead, before.pagesRead + 250);
    });

    it('pagesRead multiplies page_count by read_count for re-reads', async () => {
      // read_count is owned by updateBook (POST ignores it, PATCH whitelist
      // doesn't include it), so create the book finished first then bump
      // read_count via PUT. A 100-page book read 3× contributes 300.
      const { body: b } = await req('POST', '/api/books', {
        title: 'Re-read Book',
        page_count: 100,
        format: 'physical',
        status: 'finished',
        date_finished: '2024-06-01',
      });
      const { body: before } = await req('GET', '/api/stats');
      await req('PUT', `/api/books/${b.id}`, { ...b, read_count: 3 });
      const { body: after } = await req('GET', '/api/stats');
      // Initial create counted as 1 read (100); bumping to 3 adds 2 more
      // reads' worth of pages → +200.
      assert.equal(after.pagesRead, before.pagesRead + 200);
    });

    it('pagesRead now includes audiobooks via their print-equivalent page_count', async () => {
      // Audiobooks contribute to the lifetime pagesRead aggregate
      // once the user has filled in page_count (the print-equivalent
      // size). Before: audiobooks were excluded entirely; this kept
      // the metric pages-only but made cross-format ranking apples-to-
      // oranges. Now: a finished 400-page audiobook adds 400 to the
      // total just like any other format.
      const { body: before } = await req('GET', '/api/stats');
      await req('POST', '/api/books', {
        title: 'Finished Audiobook',
        page_count: 400,
        format: 'audiobook',
        status: 'finished',
        date_finished: '2024-06-01',
      });
      const { body: after } = await req('GET', '/api/stats');
      assert.equal(after.pagesRead, before.pagesRead + 400);
    });

    it('pagesRead skips audiobooks that have no page_count', async () => {
      // page_count > 0 is the gate — an audiobook the user hasn't yet
      // filled a print-equivalent for stays out of the aggregate so we
      // don't silently undercount the missing data.
      const { body: before } = await req('GET', '/api/stats');
      await req('POST', '/api/books', {
        title: 'Audiobook No Pages',
        format: 'audiobook',
        status: 'finished',
        date_finished: '2024-06-01',
      });
      const { body: after } = await req('GET', '/api/stats');
      assert.equal(after.pagesRead, before.pagesRead);
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

    it('records.firstFinished and at least one longestRead variant are non-null', async () => {
      const { body } = await req('GET', '/api/stats');
      assert.notEqual(body.records.firstFinished, null);
      // The format-split records: at least one should be populated given
      // the test fixtures finish books without a format set (defaults to
      // physical via validation), so longestReadPhysical takes the slot.
      const anyLongest = body.records.longestReadPhysical
                      || body.records.longestReadDigital
                      || body.records.longestReadAudiobook;
      assert.notEqual(anyLongest, null, 'expected at least one longestRead* to be non-null');
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
      // 'read' is the per-decade count of books with read_count > 0,
      // used by /data-viz's spectrum overlay.
      assert.ok('read' in modern, 'decadesPublished rows should carry a read field');
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

  describe('GET /api/stats/reading-calendar', () => {
    it('returns one row per distinct reading-log date with summed pages and minutes', async () => {
      // Two PATCHes on the same book the same calendar day fold into
      // one reading_log row via the ON CONFLICT upsert; the calendar
      // endpoint reports the summed totals.
      const { body: b } = await req('POST', '/api/books', { title: 'Calendar Smoke ' + Math.random().toString(36).slice(2, 6) });
      await req('PATCH', `/api/books/${b.id}`, { current_page:    50 });
      await req('PATCH', `/api/books/${b.id}`, { current_minutes: 30 });

      const { status, body } = await req('GET', '/api/stats/reading-calendar');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body), 'expected an array');
      // The contract: every row has date / pages / minutes; today's
      // row exists and carries at least the page/minute totals we just
      // logged (other tests' logs may have piled in). Server inserts
      // via SQLite date('now', 'localtime'), so we match using LOCAL
      // date components — UTC-formatted ISO would skew at timezone
      // boundaries.
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const todayRow = body.find(r => r.date === today);
      assert.ok(todayRow, `expected a row for ${today}`);
      assert.ok(todayRow.pages   >= 50, `pages should include the logged 50`);
      assert.ok(todayRow.minutes >= 30, `minutes should include the logged 30`);
    });
  });

  describe('GET /api/stats/audit', () => {
    it('returns audit and auditSummary off the main stats payload', async () => {
      // Audit lives behind its own endpoint so the heavyweight SUM(CASE)
      // scan doesn't run on every Stats page load. Main /api/stats must
      // not carry the audit keys; /api/stats/audit must.
      const { body: stats } = await req('GET', '/api/stats');
      assert.ok(!('audit'        in stats), 'audit should not appear in /api/stats');
      assert.ok(!('auditSummary' in stats), 'auditSummary should not appear in /api/stats');

      const { status, body } = await req('GET', '/api/stats/audit');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.audit), 'audit should be an array');
      assert.ok(body.auditSummary, 'auditSummary should be present');
      for (const key of ['cleanPct', 'totalGaps', 'totalPopulation', 'rowCount']) {
        assert.ok(key in body.auditSummary, `auditSummary missing: ${key}`);
      }
      // cleanPct must be 0..100 and rowCount must agree with the flattened
      // group rows — the page renders both, so guarantee they're coherent.
      assert.ok(body.auditSummary.cleanPct >= 0 && body.auditSummary.cleanPct <= 100);
      const flatRows = body.audit.reduce((s, g) => s + g.rows.length, 0);
      assert.equal(body.auditSummary.rowCount, flatRows);
    });
  });

  describe('GET /api/stats/library-trajectory', () => {
    it('returns monthly cumulative acquired and finished totals', async () => {
      await req('POST', '/api/books', { title: 'Trajectory Acquired ' + Math.random().toString(36).slice(2, 6), acquisition_date: '2020-03-10', owned: true });
      await req('POST', '/api/books', { title: 'Trajectory Finished ' + Math.random().toString(36).slice(2, 6), date_finished:    '2020-04-10' });

      const { status, body } = await req('GET', '/api/stats/library-trajectory');
      assert.equal(status, 200);
      assert.ok(Array.isArray(body), 'expected an array');
      assert.ok(body.length > 0, 'expected non-empty trajectory');
      // Cumulative columns must be monotonically non-decreasing.
      for (let i = 1; i < body.length; i++) {
        assert.ok(body[i].acquired >= body[i - 1].acquired, `acquired regressed at month ${body[i].month}`);
        assert.ok(body[i].finished >= body[i - 1].finished, `finished regressed at month ${body[i].month}`);
      }
      // The fixtures above must be reflected in the matching months.
      const acqMonth = body.find(r => r.month === '2020-03');
      const finMonth = body.find(r => r.month === '2020-04');
      assert.ok(acqMonth && acqMonth.acquired >= 1, 'expected 2020-03 cumulative acquired >= 1');
      assert.ok(finMonth && finMonth.finished >= 1, 'expected 2020-04 cumulative finished >= 1');
    });
  });
});
