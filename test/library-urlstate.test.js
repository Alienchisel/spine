// urlState owns the filter ↔ URL round trip — its own FILTER_ARRAY_KEYS
// list must include every multi-select filter or chip clicks become
// silent no-ops (writeFiltersToParams skips unknown keys, so the URL
// never updates and the URL-derived filter state never picks the new
// value back up). The originalLanguages case in 1.215.0 is the
// originating incident; the round-trip below catches any future drift
// between the two FILTER_ARRAY_KEYS lists.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  paramsToFilters, writeFiltersToParams, filtersEqual,
} from '../client/src/components/library/urlState.js';
import { EMPTY_FILTERS } from '../client/src/components/library/filters.js';

describe('urlState round trip', () => {
  it('round-trips every multi-select filter through writeFiltersToParams + paramsToFilters', () => {
    const fixture = {
      ...EMPTY_FILTERS,
      missing:           ['cover'],
      formats:           ['ebook'],
      ratings:           ['4'],
      publishers:        ['Hippocampus'],
      sources:           ['Audible'],
      series:            ['The Book of the New Sun'],
      originalLanguages: ['German', 'French'],
      tags:              ['Philosophy'],
      statuses:          ['reading'],
    };
    const params = new URLSearchParams();
    writeFiltersToParams(params, fixture);
    const back = paramsToFilters(params);
    assert.ok(filtersEqual(fixture, back),
      `round trip lost data — wrote ${params.toString()} and got back ${JSON.stringify(back)}`);
    // Belt-and-braces: each individual list survived.
    assert.deepEqual(back.originalLanguages, ['German', 'French']);
    assert.deepEqual(back.series,            ['The Book of the New Sun']);
    assert.deepEqual(back.tags,              ['Philosophy']);
  });

  it('filtersEqual treats originalLanguages drift as a change', () => {
    // Direct assertion that the diff function knows about the new key —
    // if it didn't, setFilters would skip the URL write as a no-op and
    // the chip click would silently fail.
    const a = { ...EMPTY_FILTERS, originalLanguages: ['German'] };
    const b = { ...EMPTY_FILTERS, originalLanguages: [] };
    assert.equal(filtersEqual(a, b), false);
  });
});
