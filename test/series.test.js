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
});
