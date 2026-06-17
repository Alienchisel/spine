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

    it('falls back to today when the date param is malformed', async () => {
      // Invalid date string should still return a card (using today's
      // date as the implicit fallback) rather than 400.
      const { status, body } = await req('GET', '/api/today/card?date=not-a-date');
      assert.equal(status, 200);
      // We seeded books above, so a card should exist.
      assert.ok(body.card, 'expected card despite malformed date param');
    });
  });
});
