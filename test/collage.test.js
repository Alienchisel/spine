// Collage endpoint contract — lock the response shape and the three
// mode behaviors so future stats refactors can't silently break the
// grid renderer.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('collage', () => {
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

  function todayIso() {
    return new Date().toLocaleDateString('en-CA');
  }

  it('defaults to top_books / 30d / size=3 when no params are given', async () => {
    const { status, body } = await req('GET', '/api/collage');
    assert.equal(status, 200);
    assert.equal(body.mode,   'top_books');
    assert.equal(body.period, '30d');
    assert.equal(body.size,   3);
    assert.ok(Array.isArray(body.tiles));
    assert.ok(body.tiles.length <= 9);
  });

  it('caps tile count at size*size', async () => {
    // Seed enough activity to exceed any grid size.
    for (let i = 0; i < 30; i++) {
      const { body: book } = await req('POST', '/api/books', {
        title: `Collage Cap Book ${i}`, authors: ['Cap Author'], fiction: true,
        page_count: 200, format: 'ebook',
      });
      await req('PATCH', `/api/books/${book.id}`, { current_page: 10 + i });
    }
    for (const size of [2, 3, 4, 5]) {
      const { body } = await req('GET', `/api/collage?mode=top_books&period=all&size=${size}`);
      assert.ok(body.tiles.length <= size * size, `size=${size}: got ${body.tiles.length} tiles`);
    }
  });

  it('top_books returns rows with id/label/sublabel/image/href', async () => {
    const { body: book } = await req('POST', '/api/books', {
      title: 'Collage Top Book A', authors: ['Top A'], fiction: true,
      page_count: 300, format: 'ebook',
    });
    await req('PATCH', `/api/books/${book.id}`, { current_page: 80 });

    const { body } = await req('GET', '/api/collage?mode=top_books&period=all&size=5');
    const tile = body.tiles.find(t => t.id === book.id);
    assert.ok(tile, 'expected our seeded book in top_books');
    assert.equal(tile.label, 'Collage Top Book A');
    assert.ok(/\d+\s*pages?/.test(tile.sublabel), `sublabel should mention pages, got: ${tile.sublabel}`);
    assert.equal(tile.href, `/books/${book.id}`);
  });

  it('top_authors aggregates across multiple books', async () => {
    const { body: ba } = await req('POST', '/api/books', {
      title: 'Author Agg A', authors: ['Aggregate Smith'], fiction: true,
      page_count: 200, format: 'ebook',
    });
    const { body: bb } = await req('POST', '/api/books', {
      title: 'Author Agg B', authors: ['Aggregate Smith'], fiction: true,
      page_count: 250, format: 'ebook',
    });
    await req('PATCH', `/api/books/${ba.id}`, { current_page: 50 });
    await req('PATCH', `/api/books/${bb.id}`, { current_page: 60 });

    const { body } = await req('GET', '/api/collage?mode=top_authors&period=all&size=5');
    const tile = body.tiles.find(t => t.label === 'Aggregate Smith');
    assert.ok(tile, 'expected Smith in top_authors');
    assert.equal(tile.sublabel, '2 books', `expected "2 books", got: ${tile.sublabel}`);
    assert.ok(tile.href.startsWith('/authors/'));
  });

  it('recently_finished orders by date_finished desc', async () => {
    const today = todayIso();
    const { body: book } = await req('POST', '/api/books', {
      title: 'Just Finished Book', authors: ['Finisher'], fiction: true,
    });
    await req('PUT', `/api/books/${book.id}/reads/finish`, {}).catch(() => {});
    // Simpler: mark finished via PUT on the book with status='finished'.
    await req('PUT', `/api/books/${book.id}`, {
      title: 'Just Finished Book', authors: ['Finisher'], fiction: true,
      status: 'finished', date_finished: today,
    });

    const { body } = await req('GET', '/api/collage?mode=recently_finished&period=all&size=5');
    assert.ok(body.tiles.length >= 1);
    assert.equal(body.tiles[0].id, book.id, 'most recent finish should be top-left');
    assert.equal(body.tiles[0].sublabel, today);
  });

  it('returns 400 on invalid mode / period', async () => {
    const bad1 = await req('GET', '/api/collage?mode=garbage');
    assert.equal(bad1.status, 400);
    const bad2 = await req('GET', '/api/collage?period=forever');
    assert.equal(bad2.status, 400);
  });

  it('clamps size to 2..5', async () => {
    const r1 = await req('GET', '/api/collage?size=1');
    assert.equal(r1.body.size, 2);
    const r2 = await req('GET', '/api/collage?size=99');
    assert.equal(r2.body.size, 5);
    const r3 = await req('GET', '/api/collage?size=abc');
    assert.equal(r3.body.size, 3);
  });

  it('series_spotlight orders by series_number then title', async () => {
    const seriesName = `Collage Spotlight Series ${Date.now()}`;
    for (const [n, title] of [[3, 'Volume Three'], [1, 'Volume One'], [2, 'Volume Two']]) {
      await req('POST', '/api/books', {
        title, authors: ['Spotlight Author'], fiction: true,
        series: seriesName, series_number: n,
      });
    }
    const { body } = await req('GET', `/api/collage?mode=series_spotlight&series=${encodeURIComponent(seriesName)}&size=5`);
    const titles = body.tiles.map(t => t.label);
    assert.deepEqual(titles, ['Volume One', 'Volume Two', 'Volume Three'], 'tiles should be in reading order');
    assert.equal(body.tiles[0].sublabel, '#1');
  });

  it('series_spotlight rejects missing series with 400', async () => {
    const r = await req('GET', '/api/collage?mode=series_spotlight');
    assert.equal(r.status, 400);
  });

  it('series_spotlight returns empty tiles for an unknown series', async () => {
    const r = await req('GET', '/api/collage?mode=series_spotlight&series=DefinitelyNotARealSeries123');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.tiles, []);
  });

  it('year_in_review bounds to books finished in the chosen calendar year', async () => {
    // Seed a book finished this year and one finished last year. Each
    // year's query should only include its own finishes.
    const currentYear = new Date().getFullYear();
    const yearBack = currentYear - 1;
    const today = new Date().toLocaleDateString('en-CA');
    const lastYearDate = `${yearBack}-06-15`;

    const { body: bThis } = await req('POST', '/api/books', {
      title: `YIR Finished Today ${Date.now()}`, authors: ['YIR Author'], fiction: true,
    });
    const { body: bLast } = await req('POST', '/api/books', {
      title: `YIR Finished Last Year ${Date.now()}`, authors: ['YIR Author'], fiction: true,
    });
    await req('PUT', `/api/books/${bThis.id}`, {
      title: bThis.title, authors: ['YIR Author'], fiction: true,
      status: 'finished', date_finished: today,
    });
    await req('PUT', `/api/books/${bLast.id}`, {
      title: bLast.title, authors: ['YIR Author'], fiction: true,
      status: 'finished', date_finished: lastYearDate,
    });

    const { body: thisYear } = await req('GET', `/api/collage?mode=year_in_review&year=${currentYear}`);
    assert.ok(thisYear.tiles.some(t => t.id === bThis.id), 'current-year query should include today-finished book');
    assert.ok(!thisYear.tiles.some(t => t.id === bLast.id), 'current-year query should exclude last-year finish');

    const { body: oldYear } = await req('GET', `/api/collage?mode=year_in_review&year=${yearBack}`);
    assert.ok(oldYear.tiles.some(t => t.id === bLast.id), 'last-year query should include last-year finish');
    assert.ok(!oldYear.tiles.some(t => t.id === bThis.id), 'last-year query should exclude current-year finish');

    // Sublabel is the date_finished (used by the client to render the
    // small caption under each tile).
    const tileThis = thisYear.tiles.find(t => t.id === bThis.id);
    assert.equal(tileThis.sublabel, today);
  });

  it('year_in_review rejects bad year inputs with 400', async () => {
    const bad1 = await req('GET', '/api/collage?mode=year_in_review&year=abc');
    assert.equal(bad1.status, 400);
    const bad2 = await req('GET', '/api/collage?mode=year_in_review&year=1850');
    assert.equal(bad2.status, 400);
    const bad3 = await req('GET', '/api/collage?mode=year_in_review&year=2200');
    assert.equal(bad3.status, 400);
  });

  it('facets endpoint returns series + years arrays', async () => {
    const { status, body } = await req('GET', '/api/collage/facets');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.series), 'series should be an array');
    assert.ok(Array.isArray(body.years),  'years should be an array');
    // Years come back as strings (substr of date column); descending.
    if (body.years.length > 1) {
      assert.ok(body.years[0] >= body.years[body.years.length - 1], 'years should be descending');
    }
  });
});
