// The search folding (shared/text.js nrm) is one implementation for the
// server's SQLite search and the client's filters / command palette. The
// palette used to only lowercase, so `author:bohm` missed Böhm-Bawerk while
// the server search found it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nrm } from '../shared/text.js';
import { nrm as clientNrm } from '../client/src/utils.js';
import { matchesQuery } from '../client/src/lib/textMatch.js';

describe('shared nrm', () => {
  it('folds diacritics, ligatures and typographic look-alikes', () => {
    assert.equal(nrm('Böhm-Bawerk'), 'bohm-bawerk');
    assert.equal(nrm('Stanisław Lem'), 'stanislaw lem');
    assert.equal(nrm('Thermæ Rōmæ'), 'thermae romae');
    assert.equal(nrm('Albion’s Seed'), "albion's seed");
    assert.equal(nrm('A—B…'), 'a-b...');
  });
  it('server keeps null, client wrapper maps it to an empty string', () => {
    assert.equal(nrm(null), null);
    assert.equal(clientNrm(null), '');
    assert.equal(clientNrm('Étienne'), nrm('Étienne'));
  });
});

describe('palette matchesQuery', () => {
  it('matches accented text from a plain query (author:bohm → Böhm-Bawerk)', () => {
    assert.equal(matchesQuery('Eugen von Böhm-Bawerk', 'bohm'), true);
    assert.equal(matchesQuery('Stanisław Lem', 'stanislaw'), true);
  });
  it('matches every token, in any order', () => {
    assert.equal(matchesQuery('The Left Hand of Darkness', 'darkness left'), true);
    assert.equal(matchesQuery('The Left Hand of Darkness', 'darkness right'), false);
  });
  it('an empty query matches everything', () => {
    assert.equal(matchesQuery('anything', ''), true);
  });
});

describe('shared localToday / currentYear', () => {
  it('formats the local calendar date, not the UTC one', async () => {
    const { localToday, currentYear } = await import('../shared/dates.js');
    // 9:30 pm local on Mar 13 is already Mar 14 in UTC; the local date wins.
    const lateEvening = new Date(2026, 2, 13, 21, 30);
    assert.equal(localToday(lateEvening), '2026-03-13');
    assert.equal(localToday(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(currentYear(new Date(2027, 11, 31, 23, 59)), 2027);
  });
});
