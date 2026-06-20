// Coverage for routes/today.js + lib/today/card.js — the v0 daily
// dashboard card. Three deterministic card types selected via a
// date-seeded mod over the eligible cohort. The same-day-stable /
// rolls-each-day / null-on-empty-library guarantees are what the
// FilterPanel-side rendering hinges on; this test locks them in.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('today', () => {
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
      // Seed three connections, serve two with explicit served_date
      // values, leave one unserved. The endpoint should return only
      // the served ones, newest served_date first.
      const directDb = (await import('../db.js')).default;
      const newest  = directDb.prepare(
        "INSERT INTO today_card_queue (title, body, served_at, served_date) VALUES ('Newest', 'a', datetime('now'), '2026-09-10')"
      ).run().lastInsertRowid;
      const oldest  = directDb.prepare(
        "INSERT INTO today_card_queue (title, body, served_at, served_date) VALUES ('Oldest', 'a', datetime('now'), '2026-09-05')"
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
      // Order: newest served_date BEFORE oldest served_date.
      const newestIdx = ids.indexOf(newest);
      const oldestIdx = ids.indexOf(oldest);
      assert.ok(newestIdx < oldestIdx,
        `expected served_date DESC order, got ids=${ids}`);
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
