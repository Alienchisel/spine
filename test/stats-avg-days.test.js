// avgDaysToFinish exact-arithmetic check, in its OWN file so it runs in its
// own process with its own in-memory DB. That's the only real isolation
// boundary: within a file, a second createTestServer() returns the same
// module-cached DB connection (see resetDb's note in helpers.js), so the
// whole-corpus AVG would fold in every other stats test's finished reads and
// only a loose `> 0` could be asserted. Alone in a fresh process, the corpus
// is exactly the two spans this test seeds, so the mean is pinned and the
// arithmetic (divisor, rounding, which reads qualify) is genuinely verified.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer, resetDb } from './helpers.js';

describe('stats — avgDaysToFinish (isolated process)', () => {
  let close;
  let req;

  before(async () => {
    const server = await createTestServer();
    close = server.close;
    req = server.req;
  });

  after(() => close());

  // Belt-and-suspenders: a clean DB before each test so adding a second test
  // here later can't silently perturb the corpus the mean is computed over.
  beforeEach(resetDb);

  it('is round(mean) of reads\' date_started → date_finished spans', async () => {
    // Two finished books → two reads rows with spans of 10 and 20 days.
    // AVG = 15; Math.round(15) = 15 (lib/stats/activity.js). julianday diffs
    // are exact for full ISO dates. A wrong divisor, an off-by-one, or an
    // added constant would all move this off 15.
    await req('POST', '/api/books', {
      title: 'Span Book 10d', status: 'finished',
      date_started: '2024-01-01', date_finished: '2024-01-11',
    });
    await req('POST', '/api/books', {
      title: 'Span Book 20d', status: 'finished',
      date_started: '2024-01-01', date_finished: '2024-01-21',
    });
    const { body } = await req('GET', '/api/stats');
    assert.equal(body.avgDaysToFinish, 15, 'mean of a 10-day and a 20-day span');
  });
});
