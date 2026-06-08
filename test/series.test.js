// Series index endpoint. Series are stored as a free-text column on
// books; the index just groups by that column and reports counts +
// publication-year / series-number ranges.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('series — index', () => {
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

  it('GET /api/series groups books by series and reports ranges', async () => {
    const stem = 'series' + Math.random().toString(36).slice(2, 6);
    const seriesName = `Chronicles of ${stem}`;
    await req('POST', '/api/books', { title: `${stem}-1`, series: seriesName, series_number: 1, year_published: 1990 });
    await req('POST', '/api/books', { title: `${stem}-2`, series: seriesName, series_number: 2, year_published: 1993 });
    await req('POST', '/api/books', { title: `${stem}-3`, series: seriesName, series_number: 4, year_published: 2001 });

    const { status, body } = await req('GET', '/api/series');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));

    const row = body.find(s => s.name === seriesName);
    assert.ok(row, 'series should appear in index');
    assert.equal(row.book_count, 3);
    assert.equal(row.min_number, 1);
    assert.equal(row.max_number, 4);
    assert.equal(row.first_year, 1990);
    assert.equal(row.last_year,  2001);
  });

  it('GET /api/series excludes books with no series and is alphabetical', async () => {
    const stem = 'order' + Math.random().toString(36).slice(2, 6);
    await req('POST', '/api/books', { title: `${stem}-loose`, /* no series */ });
    await req('POST', '/api/books', { title: `${stem}-zS`, series: `zeta-${stem}` });
    await req('POST', '/api/books', { title: `${stem}-aS`, series: `alpha-${stem}` });

    const { body } = await req('GET', '/api/series');
    const names = body.map(s => s.name);
    const aIdx = names.indexOf(`alpha-${stem}`);
    const zIdx = names.indexOf(`zeta-${stem}`);
    assert.ok(aIdx >= 0 && zIdx >= 0, 'both fixtures should appear');
    assert.ok(aIdx < zIdx, 'alpha should sort before zeta');
    // The no-series book contributes to no row in the index.
    assert.ok(!names.some(n => n.endsWith('loose')));
  });

  it('GET /api/series/completion returns one row per book with a series_number', async () => {
    const stem = 'complete' + Math.random().toString(36).slice(2, 6);
    const seriesName = `Completion-${stem}`;
    await req('POST', '/api/books', { title: `${stem}-1`, series: seriesName, series_number: 1, owned: true });
    await req('POST', '/api/books', { title: `${stem}-2`, series: seriesName, series_number: 2, owned: false });
    // A book in the same series but without a series_number — must
    // not appear in the completion feed (the sparkline needs positions).
    await req('POST', '/api/books', { title: `${stem}-unranked`, series: seriesName });

    const { status, body } = await req('GET', '/api/series/completion');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));

    const ours = body.filter(r => r.name === seriesName);
    assert.equal(ours.length, 2, 'unranked book should be excluded; only the numbered two appear');
    const positions = ours.map(r => r.position).sort((a, b) => a - b);
    assert.deepEqual(positions, [1, 2]);
    // owned is surfaced as 0/1 so the client can render filled vs hollow cells.
    const vol1 = ours.find(r => r.position === 1);
    const vol2 = ours.find(r => r.position === 2);
    assert.equal(vol1.owned, 1);
    assert.equal(vol2.owned, 0);
  });

  it('PATCH /series/loved + GET ?loved=1 — toggle, unknown-series 404, EXISTS guard', async () => {
    const stem = 'lovser' + Math.random().toString(36).slice(2, 6);
    const sA = `${stem} A`;
    const sB = `${stem} B`;
    const sGhost = `${stem} ghost`;
    const { body: ba } = await req('POST', '/api/books', { title: `${stem}-A1`, series: sA });
    const { body: bb } = await req('POST', '/api/books', { title: `${stem}-B1`, series: sB });
    try {
      await req('PATCH', '/api/series/loved', { series: sA, loved: true });
      await req('PATCH', '/api/series/loved', { series: sB, loved: true });
      const { body: row } = await req('GET', '/api/series?loved=1');
      const ours = row.filter(r => r.name === sA || r.name === sB).map(r => r.name).sort();
      assert.deepEqual(ours, [sA, sB].sort(), 'both loved series surface');

      // Unknown-series guard — typos cannot park a permanent orphan.
      const { status: ghost } = await req('PATCH', '/api/series/loved', { series: sGhost, loved: true });
      assert.equal(ghost, 404);

      // EXISTS guard — delete the only book in series B and confirm B
      // drops from the loved view even though its series_loved row
      // stays on disk (so a re-add restores the prior love).
      await req('DELETE', `/api/books/${bb.id}`);
      const { body: after } = await req('GET', '/api/series?loved=1');
      assert.ok(!after.some(r => r.name === sB), 'orphaned series drops from loved view');
      assert.ok(after.some(r => r.name === sA), 'sibling stays');

      // Unloving deletes the row.
      await req('PATCH', '/api/series/loved', { series: sA, loved: false });
      const { body: last } = await req('GET', '/api/series?loved=1');
      assert.ok(!last.some(r => r.name === sA), 'unlove drops from view');
    } finally {
      await req('DELETE', `/api/books/${ba.id}`).catch(() => {});
      await req('DELETE', `/api/books/${bb.id}`).catch(() => {});
      await req('PATCH', '/api/series/loved', { series: sA, loved: false }).catch(() => {});
      await req('PATCH', '/api/series/loved', { series: sB, loved: false }).catch(() => {});
    }
  });
});
