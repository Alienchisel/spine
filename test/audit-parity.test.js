// The audit's gap rules are written three times: AUDITS[].gapSql
// (lib/stats/audit.js), the Library's missing= filters
// (lib/books/filters.js), and the audit wizards' fetch params. Nothing
// kept them in step — if they drift, an audit row claims N books are
// missing X while clicking through to the Library shows a different set.
// This pins the first two: for every audit row that links to the Library,
// the row's count must equal the Library total for its query, over a
// deliberately varied fixture set. Own file, so the in-memory DB holds
// only these fixtures.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './helpers.js';

describe('audit rows agree with the Library filters they link to', () => {
  let close, req;
  before(async () => {
    ({ close, req } = await createTestServer());
    const { body: bl } = await req('POST', '/api/shelf/buildings', { name: 'Parity Building' });
    const { body: rm } = await req('POST', '/api/shelf/rooms', { building_id: bl.id, name: 'Parity Room' });
    const { body: un } = await req('POST', '/api/shelf/units', { room_id: rm.id, name: 'Parity Unit' });
    const { body: sh } = await req('POST', '/api/shelf/shelves', { unit_id: un.id, label: '1' });
    const placements = [{}, { building_id: bl.id }, { room_id: rm.id }, { unit_id: un.id }, { shelf_id: sh.id }];
    const formats = ['physical', 'ebook', 'audiobook', null];
    const statuses = ['unread', 'reading', 'finished'];
    // Seeded pseudo-random fixtures (mulberry32): every flag and field is
    // chosen independently, so combinations the gap rules distinguish —
    // a wishlist placeholder that's physical and unbound, an archived
    // custom audiobook — actually occur. (Fixed periods correlated them:
    // physical wishlist books only ever landed on archived rows.) Same
    // seed every run, so failures reproduce.
    let seed = 0x5eed;
    const rnd = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const chance = (p) => rnd() < p;
    for (let i = 0; i < 120; i++) {
      const owned = chance(0.6);
      const status = pick(statuses);
      const finishedDates = status === 'finished' && chance(0.6);
      const book = {
        title: `Parity Book ${i}`,
        format: pick(formats),
        status,
        owned,
        previously_owned: !owned && chance(0.3),
        is_stub: !owned && chance(0.4),
        archived: chance(0.1),
        is_custom: chance(0.06),
        ...(chance(0.75) ? { fiction: chance(0.5) } : {}),
        ...(chance(0.8) ? { authors: [`Parity Author ${i % 9}`] } : {}),
        ...(chance(0.6) ? { publisher: 'Parity Press' } : {}),
        ...(chance(0.6) ? { isbn_13: `97800000${String(10000 + i).slice(-5)}` } : {}),
        ...(chance(0.6) ? { page_count: 100 + i } : {}),
        ...(chance(0.5) ? { duration_minutes: 300 + i } : {}),
        ...(chance(0.6) ? { description: 'A blurb.' } : {}),
        ...(chance(0.5) ? { binding: 'paperback' } : {}),
        ...(chance(0.4) ? { condition: 'good' } : {}),
        ...(chance(0.5) ? { year_published: 1900 + i } : {}),
        ...(chance(0.4) ? { year_edition: 2000 + i } : {}),
        ...(chance(0.4) ? { acquisition_date: '2024-01-01' } : {}),
        ...(chance(0.5) ? { acquisition_source: 'Amazon' } : {}),
        ...(status === 'finished' && chance(0.5) ? { rating: 4 } : {}),
        ...(finishedDates ? { date_started: '2024-01-01', date_finished: '2024-02-01' } : {}),
        ...(status === 'reading' && chance(0.6) ? { date_started: '2024-03-01' } : {}),
        ...pick(placements),
      };
      const res = await req('POST', '/api/books', book);
      assert.equal(res.status, 201, `fixture ${i}: ${JSON.stringify(res.body)}`);
    }
  });
  after(() => close());

  it('every Library-linked audit row counts exactly what its Library query returns', async () => {
    const { body } = await req('GET', '/api/stats/audit');
    const rows = body.audit.flatMap(s => s.rows).filter(r => r.path === '/' && r.query);
    assert.ok(rows.length >= 30, `expected the Library-linked audit rows, got ${rows.length}`);
    const mismatches = [];
    let nonZero = 0;
    for (const r of rows) {
      const { body: lib } = await req('GET', `/api/books?${r.query}&limit=1`);
      if (r.count > 0) nonZero++;
      if (lib.total !== r.count) mismatches.push(`${r.label}: audit ${r.count} vs library ${lib.total} (${r.query})`);
    }
    assert.deepEqual(mismatches, []);
    assert.ok(nonZero >= rows.length / 2, `fixtures should give most rows a gap to count (${nonZero}/${rows.length})`);
  });
});
