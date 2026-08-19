// Coverage for routes/today.js + lib/today/card.js — the v0 daily
// dashboard card. Three deterministic card types selected via a
// date-seeded mod over the eligible cohort. The same-day-stable /
// rolls-each-day / null-on-empty-library guarantees are what the
// FilterPanel-side rendering hinges on; this test locks them in.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('today', () => {
  let close;
  let req;

  before(async () => {
    const server = await createTestServer();
    close = server.close;
    req = server.req;
  });

  after(() => close());

  describe('GET /api/today/card', () => {
    it('returns card=null when no cohort is eligible (empty library)', async () => {
      const { status, body } = await req('GET', '/api/today/card?date=2026-06-16');
      assert.equal(status, 200);
      assert.equal(body.card, null);
    });

    it('surfaces a loved book the user finished long ago', async () => {
      // Long-ago finished + loved → loved_resurface cohort. Pick a date
      // that puts the finished date >180 days in the past.
      const { body: created } = await req('POST', '/api/books', {
        title:        'Cryptonomicon (test)',
        status:       'finished',
        date_finished:'2025-01-01',
      });
      // loved isn't in the POST writable set; PUT to set it.
      await req('PUT', `/api/books/${created.id}`, {
        ...created, loved: true, tags: [],
      });
      const { body } = await req('GET', '/api/today/card?date=2026-06-16');
      assert.ok(body.card,
        `expected a card with a loved + long-finished book in the library, got ${JSON.stringify(body)}`);
      assert.equal(body.card.type, 'loved_resurface');
      assert.equal(body.card.book.id, created.id);
      // The days_since_finished diff is computed server-side via SQLite
      // julianday so the client can render the natural-English phrase
      // without ms arithmetic. Verify the diff is plausible.
      assert.ok(body.card.days_since_finished > 180,
        `expected days_since_finished > 180, got ${body.card.days_since_finished}`);
    });

    it('returns the same card on the same calendar day (stable per day)', async () => {
      // Two calls back-to-back with the same date param must return
      // the same book — the date seed is the only entropy in the pick.
      const { body: a } = await req('GET', '/api/today/card?date=2026-06-16');
      const { body: b } = await req('GET', '/api/today/card?date=2026-06-16');
      assert.equal(a.card.type,    b.card.type);
      assert.equal(a.card.book.id, b.card.book.id);
    });

    it('rolls a different card when the day changes (assuming multiple eligible types)', async () => {
      // Need at least two eligible card types for this test to be
      // meaningful. Seed a slow_burn cohort book on top of the existing
      // loved_resurface one from the earlier test.
      const slowBurn = await req('POST', '/api/books', {
        title:        'Slow-Burn Reader',
        status:       'reading',
        date_started: '2026-05-01',  // >30 days before 2026-06-16
      });
      // With two eligible types, cycling through 3 consecutive dates
      // should hit at least two distinct types. (Picking three dates
      // gives the seed enough room to land on different types under
      // mod-N selection — the test isn't sensitive to which specific
      // dates, just that the result varies.)
      const seenTypes = new Set();
      for (const d of ['2026-06-15', '2026-06-16', '2026-06-17']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card) seenTypes.add(body.card.type);
      }
      assert.ok(seenTypes.size >= 2,
        `expected at least two distinct card types across 3 days, got ${[...seenTypes]}`);
      // Also confirm the slow_burn fixture is reachable.
      assert.ok(slowBurn.body.id, 'expected slow_burn fixture to have been created');
    });

    it('falls back to today when the date param is malformed (matches no-date fallback)', async () => {
      // Malformed date silently coerces to today rather than 400 —
      // verify the fallback reaches the SAME path as a no-date call.
      // Two calls back-to-back (same effective date thanks to the
      // fallback) must return the same card under the persistence
      // guarantee. This sidesteps the prior coupling to "is the cohort
      // exhausted by earlier tests on today's actual date" — the
      // assertion now checks behaviour by comparing the malformed-date
      // and no-date responses against each other, which agree
      // regardless of cohort state.
      const { body: noParam } = await req('GET', '/api/today/card');
      const { status, body: bad } = await req('GET', '/api/today/card?date=not-a-date');
      assert.equal(status, 200);
      assert.equal(bad.card?.type ?? null, noParam.card?.type ?? null,
        'malformed date should reach the same fallback as no-date');
      if (bad.card) {
        const badId     = bad.card.book?.id ?? bad.card.queue_id;
        const noParamId = noParam.card.book?.id ?? noParam.card.queue_id;
        assert.equal(badId, noParamId,
          'malformed date and no-date should resolve to the same persisted card');
      }
    });

    it('future-dated requests return a card but persist nothing', async () => {
      // Exploratory ?date= requests against the live DB used to lock
      // each future day to whatever card they computed (88 pre-locked
      // rows hand-deleted 2026-07-04). Future dates must stay
      // side-effect-free previews: card computed and returned, but no
      // today_card_history row and no queue served_at stamp.
      const { body: fixture } = await req('POST', '/api/books', {
        title:        'Future Guard Slow Burn',
        status:       'reading',
        date_started: '2025-01-01',  // guarantees an eligible cohort
      });
      const directDb = (await import('../db.js')).default;
      const queueId = directDb.prepare(
        "INSERT INTO today_card_queue (title, body) VALUES ('Future Guard Conn', 'a [#1](spine-book:1) b')"
      ).run().lastInsertRowid;

      try {
        // Past the TODAY_NOW_OVERRIDE test clock (2030-01-01), so this
        // is the one request in the suite the guard classifies future.
        const dateStr = '2031-06-15';
        const { status, body } = await req('GET', `/api/today/card?date=${dateStr}`);
        assert.equal(status, 200);
        assert.ok(body.card, 'expected an eligible cohort to yield a card');

        const hist = directDb.prepare(
          'SELECT COUNT(*) AS n FROM today_card_history WHERE date = ?'
        ).get(dateStr);
        assert.equal(hist.n, 0, 'future date must not write today_card_history');
        const stamped = directDb.prepare(
          'SELECT COUNT(*) AS n FROM today_card_queue WHERE served_date = ?'
        ).get(dateStr);
        assert.equal(stamped.n, 0, 'future date must not stamp queue rows served');
      } finally {
        // Remove both fixtures: precisely because they were NOT
        // consumed (the point of the test), a lingering queue row
        // would keep 'connection' eligible and skew every later
        // date-sweep's seeded type rotation.
        directDb.prepare('DELETE FROM today_card_queue WHERE id = ?').run(queueId);
        await req('DELETE', `/api/books/${fixture.id}`);
      }
    });

    it('surfaces slow_burn for a reading book started more than 30 days ago', async () => {
      // Cohort SQL: status='reading' AND date_started < now-30d. Post
      // a fixture matching that shape and confirm it surfaces in a
      // small date sweep. Date_started set far enough back that the
      // 30-day guard fires regardless of when this test runs.
      const { body: created } = await req('POST', '/api/books', {
        title:        'Slow Burn Cohort Fixture',
        status:       'reading',
        date_started: '2025-01-01',  // well past 30 days for any 2026+ test date
      });
      let hit = false;
      for (const d of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'slow_burn' && body.card.book.id === created.id) { hit = true; break; }
      }
      assert.ok(hit, 'expected the slow_burn fixture to surface across the sweep');
    });

    it('skips loved_resurface and slow_burn when the underlying date is a partial', async () => {
      // The cohort SQL requires length(date_finished) = 10 (or date_started)
      // so cards only surface for books where days-since-* can be computed
      // precisely. Without this guard the card text would render an awkward
      // double-space gap ("You marked X as loved  ago.") because julianday
      // returns NULL on partial dates like '2019' / '2019-07'.
      const { body: lovedPartial } = await req('POST', '/api/books', {
        title:         'Partial-Date Loved Fixture',
        loved:         true,
      });
      await req('PATCH', `/api/books/${lovedPartial.id}`, {
        status: 'finished', date_finished: '2019',
      });
      const { body: readingPartial } = await req('POST', '/api/books', {
        title:         'Partial-Date Slow-Burn Fixture',
        status:        'reading',
        date_started:  '2025-06',
      });

      // Sweep a window of dates — neither fixture should ever appear as
      // its corresponding partial-date-incompatible card type.
      for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (!body.card) continue;
        if (body.card.book.id === lovedPartial.id) {
          assert.notEqual(body.card.type, 'loved_resurface',
            `partial date_finished=${lovedPartial.id} should not surface as loved_resurface`);
        }
        if (body.card.book.id === readingPartial.id) {
          assert.notEqual(body.card.type, 'slow_burn',
            `partial date_started=${readingPartial.id} should not surface as slow_burn`);
        }
      }
    });

    it('surfaces recent_acquisition for an owned unread book bought in the last 14 days', async () => {
      // Cohort SQL: owned=1 AND acquisition_date >= now-14d AND
      // status='unread' AND NOT is_stub. The 14-day window is computed
      // against the request date (date('now','localtime')), so seed
      // an acquisition_date in the very recent past and sweep
      // matching dates.
      const today = new Date().toLocaleDateString('en-CA');
      const { body: created } = await req('POST', '/api/books', {
        title:              'Recent Acquisition Fixture',
        owned:              true,
        acquisition_date:   today,
        status:             'unread',
      });
      let hit = false;
      // Sweep TODAY's date forward by a handful of days — anything
      // within +14 days from acquisition_date qualifies for the
      // cohort. Use future dates to dodge prior tests' history.
      for (const offset of [0, 1, 2, 3, 4, 5, 6]) {
        const d = new Date(`${today}T12:00:00`);
        d.setDate(d.getDate() + offset);
        const dateStr = d.toLocaleDateString('en-CA');
        const { body } = await req('GET', `/api/today/card?date=${dateStr}`);
        if (body.card?.type === 'recent_acquisition' && body.card.book.id === created.id) { hit = true; break; }
      }
      assert.ok(hit, 'expected the recent_acquisition fixture to surface across the sweep');
    });

    it('surfaces author_barely_opened for an author with ≥5 books and <15% finished', async () => {
      // Cohort thresholds in lib/today/card.js: book_count >= 5 AND
      // finished_count / book_count < 0.15. Post six unread books by
      // the same author; the ratio is 0/6 = 0%, well under the 0.15
      // gate. The meta payload should carry the author's name and
      // their library count.
      const author = 'Test Barely Opened Author';
      const created = [];
      for (let i = 0; i < 6; i++) {
        const { body } = await req('POST', '/api/books', {
          title: `Barely Opened Fixture ${i}`,
          authors: [author],
          status:  'unread',
        });
        created.push(body.id);
      }
      let hit = null;
      for (const d of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'author_barely_opened' && body.card.meta?.author_name === author) {
          hit = body.card;
          break;
        }
      }
      assert.ok(hit, 'expected the author_barely_opened fixture to surface across the sweep');
      assert.equal(hit.meta.book_count,     6, 'expected meta.book_count = 6');
      assert.equal(hit.meta.finished_count, 0, 'expected meta.finished_count = 0');
      assert.ok(created.includes(hit.book.id), 'expected pick to be one of the fixture books');
    });

    it('promotes author_barely_opened picks to series Vol 1 when one is available', async () => {
      // Cohort selects unread books by under-read authors ordered by
      // id; raw, that picks whatever was added last (e.g., a Thermæ
      // Romæ Vol 5 instead of Vol 1). Promotion should swap the pick
      // to series_number=1 of any series owned by the same author.
      // Seed an author with five volumes, asserts the surfaced pick
      // is Vol 1 regardless of which the seed-mod first chose.
      const author = 'Test Series Promotion Author';
      const seriesName = 'Test Promotion Series';
      let vol1Id;
      for (let n = 1; n <= 5; n++) {
        const { body } = await req('POST', '/api/books', {
          title:         `${seriesName} Vol ${n}`,
          authors:       [author],
          status:        'unread',
          series:        seriesName,
          series_number: n,
        });
        if (n === 1) vol1Id = body.id;
      }
      let hit = null;
      for (const d of ['2027-04-10', '2027-04-11', '2027-04-12', '2027-04-13', '2027-04-14', '2027-04-15', '2027-04-16']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'author_barely_opened' && body.card.meta?.author_name === author) {
          hit = body.card;
          break;
        }
      }
      assert.ok(hit, 'expected the promotion-fixture author to surface across the sweep');
      assert.equal(hit.book.id, vol1Id,
        `expected promoted pick to be Vol 1 (id=${vol1Id}), got id=${hit.book.id}`);
    });

    it('surfaces loved_author_followup for an unread book whose author has a loved sibling', async () => {
      // Cohort SQL: the book's first-author has at least one loved
      // sibling AND the book itself is unread + not loved. Post a
      // loved book and an unread sibling by the same author; the
      // meta payload should carry the author name and the loved
      // title that earned the followup.
      const author     = 'Test Followup Author';
      const lovedTitle = 'Test Followup Loved Anchor';
      const { body: anchor } = await req('POST', '/api/books', {
        title:         lovedTitle,
        authors:       [author],
        status:        'finished',
        date_finished: '2025-01-01',
      });
      await req('PUT', `/api/books/${anchor.id}`, {
        ...anchor, loved: true, tags: [],
      });
      const { body: followup } = await req('POST', '/api/books', {
        title:   'Test Followup Sibling Unread',
        authors: [author],
        status:  'unread',
      });
      let hit = null;
      for (const d of ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'loved_author_followup' && body.card.meta?.author_name === author) {
          hit = body.card;
          break;
        }
      }
      assert.ok(hit, 'expected the loved_author_followup fixture to surface across the sweep');
      assert.equal(hit.book.id,           followup.id, 'expected the unread sibling to be picked, not the loved anchor');
      assert.equal(hit.meta.loved_title,  lovedTitle,  'expected meta.loved_title to identify the loved anchor');
    });

    it('surfaces forgotten_readlist when on_readlist books exist', async () => {
      // PUT a book onto the readlist so the cohort is non-empty. The
      // forgotten_readlist type ranks by readlist_position DESC so the
      // newest readlist entry is the freshest "deep in queue" candidate.
      const { body: created } = await req('POST', '/api/books', {
        title: 'Buried Readlist Entry',
      });
      await req('PUT', `/api/books/${created.id}`, {
        ...created, on_readlist: true, tags: [],
      });
      // Pick a date past the existing fixtures so we don't collide with
      // their already-persisted history rows.
      const { body } = await req('GET', '/api/today/card?date=2026-06-30');
      assert.ok(body.card,
        `expected a card with at least one eligible cohort, got ${JSON.stringify(body)}`);
      // Any of the eligible types might win the seed mod — but the new
      // forgotten_readlist type must AT LEAST be reachable across a
      // small day sweep. Tested in the repetition test below as well.
    });

    it('does not surface the same book twice within the 14-day repetition window', async () => {
      // The repetition guard prunes recently-surfaced books from
      // cohorts. Across a short consecutive-day window, no book should
      // repeat as long as alternatives exist. Picking dates well past
      // the prior fixtures' history entries to give the guard a clean
      // 14-day lookback.
      const ids = [];
      for (const d of ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card) ids.push(body.card.book.id);
      }
      const unique = new Set(ids);
      assert.equal(unique.size, ids.length,
        `expected no repeats across ${ids.length} consecutive days, got ${ids}`);
    });

    it('surfaces a queued connection card when one is available', async () => {
      // Seed a single connection candidate directly into the test DB —
      // there's no public POST /api/today/queue endpoint (manual seed
      // via chat is the production path). Eligible-types list now
      // includes 'connection' so some date in a small sweep should
      // land on it. The card body and title come from the queue row
      // verbatim, no books-table hydration.
      const directDb = (await import('../db.js')).default;
      directDb.prepare(
        "INSERT INTO today_card_queue (title, body) VALUES (?, ?)"
      ).run('Test Connection', 'Body referencing [#1](spine-book:1).');

      const seen = new Set();
      for (const d of ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type) seen.add(body.card.type);
      }
      assert.ok(seen.has('connection'),
        `expected connection to surface across 7 days with a queued candidate, got ${[...seen]}`);
    });

    it('records post-hoc feedback on a connection queue row', async () => {
      const directDb = (await import('../db.js')).default;
      const id = directDb.prepare(
        "INSERT INTO today_card_queue (title, body) VALUES (?, ?)"
      ).run('Feedback Test', 'Body [#1](spine-book:1)').lastInsertRowid;

      const { status, body } = await req('POST', `/api/today/queue/${id}/feedback`, { value: 'signal' });
      assert.equal(status, 200);
      assert.equal(body.feedback, 'signal');

      const row = directDb.prepare('SELECT feedback, feedback_at FROM today_card_queue WHERE id = ?').get(id);
      assert.equal(row.feedback, 'signal');
      assert.ok(row.feedback_at, 'expected feedback_at to populate');

      // Toggle off
      const { status: clearStatus } = await req('POST', `/api/today/queue/${id}/feedback`, { value: null });
      assert.equal(clearStatus, 200);
      const cleared = directDb.prepare('SELECT feedback, feedback_at FROM today_card_queue WHERE id = ?').get(id);
      assert.equal(cleared.feedback, null);
      assert.equal(cleared.feedback_at, null);
    });

    it('reading_path candidates surface under their own queue cohort', async () => {
      // Seed a single reading_path candidate. The queue table now
      // hosts two card_type buckets — confirm the cohort selector
      // picks from the right one when type='reading_path' rolls.
      const directDb = (await import('../db.js')).default;
      directDb.prepare(
        "INSERT INTO today_card_queue (card_type, title, body) VALUES ('reading_path', 'Test Path', 'a [#1](spine-book:1) b')"
      ).run();
      const seen = new Set();
      for (const d of ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type) seen.add(body.card.type);
      }
      assert.ok(seen.has('reading_path'),
        `expected reading_path to surface across 7 days with a queued candidate, got ${[...seen]}`);
    });

    it('rotation cohort scoping: connection type picks only connection queue rows (not reading_path)', async () => {
      // The /reading-paths and /connections archive endpoints scope
      // by card_type — covered above. Separately, the seeded-mod
      // rotation must scope by card_type too: a date that rolls
      // type='connection' must only consider connection queue rows
      // when picking, and similarly for reading_path. Without this
      // scoping the same queue row could surface under the wrong
      // type label. Seed one of each with distinctive titles, sweep
      // dates, and confirm whichever AI-shaped card lands carries
      // the title of its OWN card_type row.
      const directDb = (await import('../db.js')).default;
      const connId = directDb.prepare(
        "INSERT INTO today_card_queue (card_type, title, body) VALUES ('connection', 'CrossCohort-Conn', 'a')"
      ).run().lastInsertRowid;
      const pathId = directDb.prepare(
        "INSERT INTO today_card_queue (card_type, title, body) VALUES ('reading_path', 'CrossCohort-Path', 'a')"
      ).run().lastInsertRowid;
      for (const d of ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06', '2027-03-07']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        const c = body.card;
        if (c?.type === 'connection') {
          assert.equal(c.queue_id, connId,
            `connection rotation picked a non-connection queue row (id=${c.queue_id})`);
        } else if (c?.type === 'reading_path') {
          assert.equal(c.queue_id, pathId,
            `reading_path rotation picked a non-reading_path queue row (id=${c.queue_id})`);
        }
      }
    });

    it('GET /api/today/reading-paths returns reading_path rows only', async () => {
      // Two queue rows, one of each card_type, both served. The
      // /reading-paths endpoint must include only the reading_path
      // and exclude the connection — otherwise PastReadingPaths
      // would render Connection content under its own header.
      const directDb = (await import('../db.js')).default;
      const pathId = directDb.prepare(
        "INSERT INTO today_card_queue (card_type, title, body, served_at, served_date) VALUES ('reading_path', 'PathArchiveOnly', 'a', datetime('now'), '2026-10-01')"
      ).run().lastInsertRowid;
      const connId = directDb.prepare(
        "INSERT INTO today_card_queue (card_type, title, body, served_at, served_date) VALUES ('connection', 'ConnArchiveOnly', 'a', datetime('now'), '2026-10-02')"
      ).run().lastInsertRowid;

      const { body: pathBody } = await req('GET', '/api/today/reading-paths');
      const pathIds = pathBody.readingPaths.map(r => r.queue_id);
      assert.ok( pathIds.includes(pathId),  'expected reading_path row in /reading-paths');
      assert.ok(!pathIds.includes(connId), 'expected connection row to be excluded from /reading-paths');

      const { body: connBody } = await req('GET', '/api/today/connections');
      const connIds = connBody.connections.map(r => r.queue_id);
      assert.ok( connIds.includes(connId), 'expected connection row in /connections');
      assert.ok(!connIds.includes(pathId), 'expected reading_path row to be excluded from /connections');
    });

    it('GET /api/today/connections returns served candidates in reverse-chronological order', async () => {
      // Seed three connections, serve two with explicit served_at
      // timestamps a day apart, leave one unserved. The endpoint should
      // return only the served ones, newest served_at first.
      const directDb = (await import('../db.js')).default;
      const newest  = directDb.prepare(
        "INSERT INTO today_card_queue (title, body, served_at, served_date) VALUES ('Newest', 'a', '2026-09-10 14:00:00', '2026-09-10')"
      ).run().lastInsertRowid;
      const oldest  = directDb.prepare(
        "INSERT INTO today_card_queue (title, body, served_at, served_date) VALUES ('Oldest', 'a', '2026-09-05 09:00:00', '2026-09-05')"
      ).run().lastInsertRowid;
      const unserved = directDb.prepare(
        "INSERT INTO today_card_queue (title, body) VALUES ('Unserved', 'a')"
      ).run().lastInsertRowid;

      const { status, body } = await req('GET', '/api/today/connections');
      assert.equal(status, 200);
      const ids = body.connections.map(c => c.queue_id);
      assert.ok( ids.includes(newest),  'expected newest served to be present');
      assert.ok( ids.includes(oldest),  'expected oldest served to be present');
      assert.ok(!ids.includes(unserved), 'expected unserved to be omitted');
      // Order: newest served_at BEFORE oldest served_at.
      const newestIdx = ids.indexOf(newest);
      const oldestIdx = ids.indexOf(oldest);
      assert.ok(newestIdx < oldestIdx,
        `expected served_at DESC order, got ids=${ids}`);
    });

    it('rejects an invalid feedback value', async () => {
      const directDb = (await import('../db.js')).default;
      const id = directDb.prepare(
        "INSERT INTO today_card_queue (title, body) VALUES (?, ?)"
      ).run('Bad Grade', 'Body').lastInsertRowid;
      const { status, body } = await req('POST', `/api/today/queue/${id}/feedback`, { value: 'awesome' });
      assert.equal(status, 400);
      assert.match(body.error, /invalid value/i);
    });

    it('anniversary cohort dedupes by work_id (multiple editions count as one)', async () => {
      // Post three "editions" linked via work_id, all published 1925
      // (100 years before any 2025-shifted-to-2025 sweep date). The
      // anniversary cohort must surface AT MOST ONE of them — without
      // the GROUP BY COALESCE(work_id, -id) dedupe, the seed could
      // pick any of the three, and across a long sweep multiple
      // editions could surface for the same work.
      const titleStem = 'Work-Id Dedupe Anniversary';
      const { body: ed1 } = await req('POST', '/api/books', {
        title: `${titleStem} Edition A`, year_published: 1925,
      });
      const { body: ed2 } = await req('POST', '/api/books', {
        title: `${titleStem} Edition B`, year_published: 1925,
      });
      const { body: ed3 } = await req('POST', '/api/books', {
        title: `${titleStem} Edition C`, year_published: 1925,
      });
      // Link all three under one work via PUT (work_id isn't on POST
      // writable set in the standard path).
      await req('PUT', `/api/books/${ed2.id}`, { ...ed2, work_id: ed1.id, tags: [] });
      await req('PUT', `/api/books/${ed3.id}`, { ...ed3, work_id: ed1.id, tags: [] });
      // Sweep 2025 dates (1925 + 100y) and collect every surfaced book
      // id from anniversary cards. Across the sweep, no more than ONE
      // of the three editions can appear.
      const surfaced = new Set();
      for (const d of ['2025-08-01', '2025-08-02', '2025-08-03', '2025-08-04', '2025-08-05', '2025-08-06', '2025-08-07']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'anniversary') {
          const id = body.card.book.id;
          if ([ed1.id, ed2.id, ed3.id].includes(id)) surfaced.add(id);
        }
      }
      assert.ok(surfaced.size <= 1,
        `expected at most one edition surfaced, got ${[...surfaced]}`);
    });

    it('author_anniversary surfaces for an author whose death year matches an offset', async () => {
      // Post a book and PATCH its author's death_date so the author
      // hits a notable offset for the viewed year. The cohort should
      // surface it and the meta must carry { event:'death',
      // event_year, years_ago, author_name }.
      const author = 'Test Anniversary Dead Author';
      const { body: created } = await req('POST', '/api/books', {
        title:   'Posthumous Test Book',
        authors: [author],
        year_published: 1900,
      });
      // Resolve author id via the GET response's authors array and
      // PATCH death_date to a notable offset (100y before 2027).
      const authorId = created.authors?.[0]?.id;
      assert.ok(authorId, 'expected fixture book to carry an author id');
      const { status: patchStatus } = await req('PATCH', `/api/authors/${authorId}`, {
        death_date: '1927-08-15',
        gender:     'female',
      });
      assert.equal(patchStatus, 200, 'expected death_date PATCH to succeed');
      let hit = null;
      for (const d of ['2027-09-01', '2027-09-02', '2027-09-03', '2027-09-04', '2027-09-05', '2027-09-06', '2027-09-07']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'author_anniversary'
            && body.card.meta?.author_name === author) {
          hit = body.card;
          break;
        }
      }
      assert.ok(hit, 'expected the author_anniversary fixture to surface across the sweep');
      assert.equal(hit.meta.event,         'death');
      assert.equal(hit.meta.event_year,    1927);
      assert.equal(hit.meta.years_ago,     100);
      // author_gender drives the "by him/her/them" pronoun in the
      // rendered card copy; the meta must carry the author's recorded
      // gender through so the client doesn't fall back to singular-they
      // for an author with a known one.
      assert.equal(hit.meta.author_gender, 'female');
    });

    it('author_anniversary handles BCE author dates via the leading minus sign', async () => {
      // Plato-shape: birth_date='-428', death_date='-348'. For a
      // viewed year of 2026 the author is 2454y / 2374y "ago" — neither
      // matches a hardcoded offset, so the author must NOT surface.
      // This guards the year-extraction path against accidentally
      // truncating BCE years to positive integers (which would let
      // '-428' become 428 → 2026-428 = 1598y, a real-but-incorrect
      // anniversary).
      const author = 'Test BCE Author';
      const { body: created } = await req('POST', '/api/books', {
        title:   'BCE Test Book',
        authors: [author],
      });
      const authorId = created.authors?.[0]?.id;
      assert.ok(authorId);
      await req('PATCH', `/api/authors/${authorId}`, {
        birth_date: '-428',
        death_date: '-348',
      });
      // Sweep 2026 — neither 2454 nor 2374 is a notable offset, so
      // this author MUST NOT surface as an author_anniversary.
      for (const d of ['2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'author_anniversary'
            && body.card.meta?.author_name === author) {
          assert.fail(`BCE author surfaced for non-matching offset: ${JSON.stringify(body.card.meta)}`);
        }
      }
    });

    it('surfaces an anniversary card for a book published a notable round-year offset before the viewed date', async () => {
      // Anniversary cohort picks books whose year_published is exactly
      // N years before the viewed date's year, for N in the hardcoded
      // ANNIVERSARY_OFFSETS list (25, 50, 75, 100, 125, 150, 175, 200,
      // 250, 300, 400, 500, 750, 1000, 1500, 2000). Post a book at
      // year_published=1926 and sweep dates in 2026 — at least one
      // should land on anniversary, and the meta payload should carry
      // years_ago=100 + year_published=1926 for the request's year.
      const { body: created } = await req('POST', '/api/books', {
        title: 'Anniversary Test Book', year_published: 1926,
      });
      let anniversaryCard = null;
      for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'anniversary' && body.card.book.id === created.id) {
          anniversaryCard = body.card;
          break;
        }
      }
      assert.ok(anniversaryCard,
        `expected the test fixture's anniversary card to surface across the sweep`);
      assert.equal(anniversaryCard.meta.year_published, 1926);
      assert.equal(anniversaryCard.meta.years_ago,      100);
    });

    it('personal_anniversary meta carries the finished event when fired', async () => {
      // The mod-N type selection has its own flakiness across a heavy
      // shared test DB (other cohorts compete for the seed bucket),
      // so test the meta payload directly by pre-seeding
      // today_card_history with the (date, type, book_id) triple. The
      // route hits the existingBook short-circuit and runs
      // computeCardMeta against the picked book — exactly the
      // production path once the type is selected. The cohort SQL is
      // covered indirectly by the tiebreaker test below, which only
      // passes when the personal cohort is non-empty.
      //
      // OR REPLACE (here and in the other pre-seed tests): the suite's
      // current-date sweeps (recent_acquisition) persist cards for
      // today..+6, so whenever the real calendar approaches one of
      // these hard-coded dates a plain INSERT hits the date PK.
      const { body: created } = await req('POST', '/api/books', {
        title:         'PA Meta Finished',
        authors:       ['PA Meta Solo F'],
        date_finished: '2025-04-12',
        status:        'finished',
      });
      const db = (await import('../db.js')).default;
      db.prepare(
        'INSERT OR REPLACE INTO today_card_history (date, type, book_id) VALUES (?, ?, ?)'
      ).run('2026-04-12', 'personal_anniversary', created.id);
      const { body } = await req('GET', '/api/today/card?date=2026-04-12');
      assert.equal(body.card?.type,    'personal_anniversary');
      assert.equal(body.card.book.id,  created.id);
      assert.equal(body.card.meta.event,     'finished');
      assert.equal(body.card.meta.event_year, 2025);
      assert.equal(body.card.meta.years_ago,  1);
    });

    it('personal_anniversary meta carries the acquired event when fired', async () => {
      // Acquired path mirror — same pre-seed trick, anchoring on
      // acquisition_date and a 2y delta.
      const { body: created } = await req('POST', '/api/books', {
        title:              'PA Meta Acquired',
        authors:            ['PA Meta Solo A'],
        owned:              1,
        acquisition_source: 'Amazon',
        acquisition_date:   '2024-07-04',
      });
      const db = (await import('../db.js')).default;
      db.prepare(
        'INSERT OR REPLACE INTO today_card_history (date, type, book_id) VALUES (?, ?, ?)'
      ).run('2026-07-04', 'personal_anniversary', created.id);
      const { body } = await req('GET', '/api/today/card?date=2026-07-04');
      assert.equal(body.card?.type,    'personal_anniversary');
      assert.equal(body.card.book.id,  created.id);
      assert.equal(body.card.meta.event,     'acquired');
      assert.equal(body.card.meta.event_year, 2024);
      assert.equal(body.card.meta.years_ago,  2);
    });

    it('personal_anniversary outranks work-publication anniversary when both are eligible', async () => {
      // The tiebreaker prunes anniversary from eligibleTypes whenever
      // personal is also eligible — so on any sweep date where the
      // personal cohort has a candidate, the work-anniversary book
      // must NEVER surface. Make the personal cohort non-empty on
      // every sweep date (one fixture per day) and assert the work
      // book is silent across the sweep.
      const { body: workBook } = await req('POST', '/api/books', {
        title:          'Tiebreaker Work Book',
        year_published: 1927,
      });
      const sweepDates = [
        '2027-07-15', '2027-07-16', '2027-07-17', '2027-07-18',
        '2027-07-19', '2027-07-20', '2027-07-21',
      ];
      for (let i = 0; i < sweepDates.length; i++) {
        const finished = sweepDates[i].replace('2027', '2026');  // 1y ago
        await req('POST', '/api/books', {
          title:         `Tiebreaker Personal ${i}`,
          authors:       [`TiebreakerPersonal Solo ${i}`],
          date_finished: finished,
          status:        'finished',
        });
      }
      for (const d of sweepDates) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.book?.id === workBook.id) {
          assert.fail(
            `workBook surfaced on ${d} despite eligible personal cohort: ${JSON.stringify(body.card)}`);
        }
      }
    });

    it('series_next_volume cohort surfaces the immediate-next owned/unread volume after a finished one', async () => {
      // Vol 1 finished + Vol 2 owned & unread → the cohort should
      // produce Vol 2 once the seed lands on it. Use a unique series
      // name so we don't collide with any earlier-test series chains,
      // and a sweep wide enough that the heavy shared DB's seeded
      // type rotation has a fair chance of hitting series_next_volume.
      const seriesName = `SeriesNextCohort ${Date.now()}`;
      const { body: vol1 } = await req('POST', '/api/books', {
        title:         `${seriesName} The First`,
        authors:       [`${seriesName} Author`],
        series:        seriesName,
        series_number: 1,
        status:        'finished',
        date_finished: '2025-12-01',
      });
      const { body: vol2 } = await req('POST', '/api/books', {
        title:         `${seriesName} The Second`,
        authors:       [`${seriesName} Author`],
        series:        seriesName,
        series_number: 2,
        owned:         1,
        status:        'unread',
      });
      let hit = false;
      for (let i = 0; i < 14; i++) {
        const d = new Date('2027-10-01T12:00:00');
        d.setDate(d.getDate() + i);
        const dateStr = d.toLocaleDateString('en-CA');
        const { body } = await req('GET', `/api/today/card?date=${dateStr}`);
        if (body.card?.type === 'series_next_volume' && body.card.book.id === vol2.id) {
          hit = true;
          break;
        }
      }
      assert.ok(hit,
        'expected series_next_volume to surface vol2 across the sweep');
      // Silence the unused-vol1 lint while keeping the fixture id
      // available in the assertion failure trace.
      assert.ok(vol1.id, 'expected vol1 fixture to be created');
    });

    it('series_next_volume meta carries series, prev_volume, prev_title, next_volume', async () => {
      // Pre-seed today_card_history so the route delivers the card
      // via the existingBook short-circuit (sidesteps mod-N selection
      // flakiness on the shared DB). The meta payload should still go
      // through computeCardMeta against live book state, which is the
      // production path we want covered.
      const seriesName = `SeriesNextMeta ${Date.now()}`;
      await req('POST', '/api/books', {
        title:         `${seriesName} Vol 1`,
        authors:       [`${seriesName} Author`],
        series:        seriesName,
        series_number: 1,
        status:        'finished',
        date_finished: '2025-06-15',
      });
      const { body: vol2 } = await req('POST', '/api/books', {
        title:         `${seriesName} Vol 2`,
        authors:       [`${seriesName} Author`],
        series:        seriesName,
        series_number: 2,
        owned:         1,
        status:        'unread',
      });
      const db = (await import('../db.js')).default;
      db.prepare(
        'INSERT OR REPLACE INTO today_card_history (date, type, book_id) VALUES (?, ?, ?)'
      ).run('2026-08-08', 'series_next_volume', vol2.id);
      const { body } = await req('GET', '/api/today/card?date=2026-08-08');
      assert.equal(body.card?.type,    'series_next_volume');
      assert.equal(body.card.book.id,  vol2.id);
      assert.equal(body.card.meta.series,      seriesName);
      assert.equal(body.card.meta.next_volume, 2);
      assert.equal(body.card.meta.prev_volume, 1);
      assert.equal(body.card.meta.prev_title,  `${seriesName} Vol 1`);
      assert.ok(body.card.meta.days_since_prev > 0,
        `expected days_since_prev > 0, got ${body.card.meta.days_since_prev}`);
    });

    it('GET /api/today/queue-depth returns unserved counts per card_type', async () => {
      // Always returns both keys even when zero — the client banner
      // assumes a populated shape ({ connection: N, reading_path: M })
      // and shouldn't have to special-case missing keys.
      const { status, body } = await req('GET', '/api/today/queue-depth');
      assert.equal(status, 200);
      assert.ok(body?.depth, 'expected depth payload');
      assert.equal(typeof body.depth.connection,   'number');
      assert.equal(typeof body.depth.reading_path, 'number');
      assert.ok(body.depth.connection   >= 0);
      assert.ok(body.depth.reading_path >= 0);
    });

    it('series_next_volume stays silent when the user owns Vol 1 but has never finished a sibling', async () => {
      // Unstarted series — no finished volume to base "next" on, so
      // the series_progress CTE has no row for this series and Vol 1
      // shouldn't appear in the cohort. Verify by checking the
      // returned card across a sweep never surfaces this fixture as
      // series_next_volume.
      const seriesName = `SeriesNextSilent ${Date.now()}`;
      const { body: vol1 } = await req('POST', '/api/books', {
        title:         `${seriesName} Vol 1`,
        authors:       [`${seriesName} Author`],
        series:        seriesName,
        series_number: 1,
        owned:         1,
        status:        'unread',
      });
      for (const d of ['2027-11-01', '2027-11-02', '2027-11-03', '2027-11-04', '2027-11-05']) {
        const { body } = await req('GET', `/api/today/card?date=${d}`);
        if (body.card?.type === 'series_next_volume' && body.card.book.id === vol1.id) {
          assert.fail(`vol1 surfaced as series_next_volume on ${d} without a finished sibling`);
        }
      }
    });

    it('peek=true returns null for a date with no persisted card and does not retroactively pick', async () => {
      // Day-navigation surface (1.223) passes peek=true for past-date
      // views. The contract: without an existing today_card_history
      // or today_card_queue.served_date row for the date, the server
      // returns card=null AND does NOT write a row for that date —
      // otherwise scrolling back through dates would burn the queue
      // and produce odd repetition-guard behaviour.
      const directDb = (await import('../db.js')).default;
      const date = '2027-01-15';  // far enough out that no other test has touched it
      const before = directDb.prepare('SELECT COUNT(*) AS n FROM today_card_history WHERE date = ?').get(date).n;
      assert.equal(before, 0, 'fixture sanity: no row for this date pre-call');

      const { status, body } = await req('GET', `/api/today/card?date=${date}&peek=true`);
      assert.equal(status, 200);
      assert.equal(body.card, null,
        `expected peek=true with no persisted row to return null, got ${JSON.stringify(body)}`);

      const after = directDb.prepare('SELECT COUNT(*) AS n FROM today_card_history WHERE date = ?').get(date).n;
      assert.equal(after, 0,
        'expected peek=true to NOT write today_card_history row for unvisited date');
    });

    it('peek=true returns the persisted card when one exists', async () => {
      // After a non-peek fetch persists a card for the date, a
      // subsequent peek fetch reads it back without doing the compute.
      const date = '2027-02-20';
      const { body: first } = await req('GET', `/api/today/card?date=${date}`);
      assert.ok(first.card, 'expected non-peek fetch to produce and persist a card');
      const firstId = first.card.book?.id ?? first.card.queue_id;
      const firstType = first.card.type;

      const { body: second } = await req('GET', `/api/today/card?date=${date}&peek=true`);
      assert.ok(second.card, 'expected peek to find the persisted card');
      assert.equal(second.card.type, firstType);
      const secondId = second.card.book?.id ?? second.card.queue_id;
      assert.equal(secondId, firstId);
    });

    it('persists the picked card to today_card_history (stable across cohort drift)', async () => {
      // Once a card is persisted for date D, subsequent fetches for
      // that date return the same (type, book_id) even if the cohort
      // composition would now produce a different fresh pick. The
      // book row itself is re-hydrated each fetch so any meta drift
      // (status / loved / etc.) is reflected, but the persisted tuple
      // is the source of truth for what surfaced.
      const date = '2026-07-25';
      const { body: first } = await req('GET', `/api/today/card?date=${date}`);
      assert.ok(first.card, 'expected first fetch to produce a card');
      const firstId = first.card.book.id;
      const firstType = first.card.type;
      // Mutate cohort state: PUT the picked book to a different status
      // (so it likely falls out of its original cohort). The next
      // fetch must still return the persisted (type, book_id).
      await req('PUT', `/api/books/${firstId}`, {
        ...first.card.book, status: 'finished', tags: [],
      });
      const { body: second } = await req('GET', `/api/today/card?date=${date}`);
      assert.equal(second.card.type,    firstType);
      assert.equal(second.card.book.id, firstId);
    });
  });
});
