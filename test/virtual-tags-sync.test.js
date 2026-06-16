// VIRTUAL_TAG_RULES (lib/books/filters.js) and VIRTUAL_TAG_NAMES
// (shared/bookFields.js) are deliberate duplicates — the filters module
// pulls server-only SQLite imports and can't be loaded in the browser
// bundle, so the client gets a names-only copy via shared/. Drift
// between the two would either let BookForm offer virtual tags as
// user-pickable past suggestions or break FilterPanel's All/Any
// tagsMode visibility check. The names file's own comment says "keep
// in sync" — this is the test that enforces it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VIRTUAL_TAG_RULES } from '../lib/books/filters.js';
import { VIRTUAL_TAG_NAMES } from '../shared/bookFields.js';

describe('virtual-tag list sync', () => {
  it('VIRTUAL_TAG_RULES (server) and VIRTUAL_TAG_NAMES (shared) agree on the name set', () => {
    const ruleNames   = [...VIRTUAL_TAG_RULES].map(r => r.name).sort();
    const sharedNames = [...VIRTUAL_TAG_NAMES].sort();
    assert.deepEqual(ruleNames, sharedNames,
      `virtual-tag lists drifted — lib/books/filters.js has ${JSON.stringify(ruleNames)}, shared/bookFields.js has ${JSON.stringify(sharedNames)}`);
  });
});
