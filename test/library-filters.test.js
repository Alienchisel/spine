// Defends against stale / corrupt sessionStorage blobs that would
// otherwise reach FilterPanel / pruneFilters / buildApiParams as
// wrongly-shaped data and crash on .filter / .includes / .length.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FILTERS, normalizeFilters } from '../client/src/components/library/filters.js';

describe('normalizeFilters', () => {
  it('returns EMPTY_FILTERS for null / undefined / non-objects', () => {
    assert.deepEqual(normalizeFilters(null),      EMPTY_FILTERS);
    assert.deepEqual(normalizeFilters(undefined), EMPTY_FILTERS);
    assert.deepEqual(normalizeFilters('garbage'), EMPTY_FILTERS);
    assert.deepEqual(normalizeFilters(42),        EMPTY_FILTERS);
  });

  it('preserves a fully-valid saved filter object', () => {
    const saved = {
      ...EMPTY_FILTERS,
      formats: ['ebook', 'audiobook'],
      tags:    ['Philosophy'],
      tagsMode:'any',
      owned:   true,
      loved:   false,
    };
    const out = normalizeFilters(saved);
    assert.deepEqual(out.formats,  ['ebook', 'audiobook']);
    assert.deepEqual(out.tags,     ['Philosophy']);
    assert.equal(out.tagsMode,     'any');
    assert.equal(out.owned,        true);
    assert.equal(out.loved,        false);
  });

  it('coerces a string-where-array field back to []', () => {
    // The headline scenario: stale sessionStorage with `formats: 'ebook'`
    // would otherwise crash pruneFilters' `filters.formats.filter(...)`.
    const out = normalizeFilters({ formats: 'ebook', tags: 'Philosophy' });
    assert.deepEqual(out.formats, []);
    assert.deepEqual(out.tags,    []);
  });

  it('rejects a bad tagsMode and falls back to "all"', () => {
    const out = normalizeFilters({ tagsMode: 'maybe' });
    assert.equal(out.tagsMode, 'all');
  });

  it('coerces non-tristate values for tristate booleans to null', () => {
    const out = normalizeFilters({
      owned: 'yes', previouslyOwned: 1, custom: 0, loved: undefined,
    });
    assert.equal(out.owned,           null);
    assert.equal(out.previouslyOwned, null);
    assert.equal(out.custom,          null);
    assert.equal(out.loved,           null);
  });

  it('drops unknown keys from the saved blob', () => {
    const out = normalizeFilters({ formats: ['ebook'], futureField: 'whatever' });
    assert.deepEqual(out.formats, ['ebook']);
    assert.equal('futureField' in out, false);
  });

  it('fills missing fields from EMPTY_FILTERS', () => {
    // Forward-compatibility the other way: an old blob predates a new
    // filter field; normalize must still surface that field.
    const out = normalizeFilters({ formats: ['ebook'] });
    assert.deepEqual(out.tags,              []);
    assert.deepEqual(out.statuses,          []);
    assert.deepEqual(out.originalLanguages, []);
    assert.deepEqual(out.editionLanguages,  []);
    assert.equal(out.tagsMode,              'all');
    assert.equal(out.owned,                 null);
  });

  it('does not mutate the caller', () => {
    const saved = { formats: ['ebook'] };
    normalizeFilters(saved);
    assert.deepEqual(saved, { formats: ['ebook'] });
  });
});
