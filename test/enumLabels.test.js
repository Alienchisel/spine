// ENUM_LABELS is the single source of display wording for every enum
// field; its keys must stay exactly the allowed values, or a dropdown
// would offer a value the server rejects (or miss one it accepts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ENUM_VALUES, ENUM_LABELS, enumOptions } from '../shared/bookFields.js';

describe('ENUM_LABELS', () => {
  it('has a label map for every enum field', () => {
    assert.deepEqual(Object.keys(ENUM_LABELS).sort(), Object.keys(ENUM_VALUES).sort());
  });
  for (const field of Object.keys(ENUM_VALUES)) {
    it(`${field}: labels cover exactly the allowed values`, () => {
      assert.deepEqual(Object.keys(ENUM_LABELS[field]).sort(), [...ENUM_VALUES[field]].sort());
    });
  }
  it('uses one wording for condition everywhere (was "Very good" in the audit wizard)', () => {
    assert.equal(ENUM_LABELS.condition['very good'], 'Very Good');
  });
  it('enumOptions returns value/label pairs in display order', () => {
    assert.deepEqual(enumOptions('status').map(o => o.value), ['unread', 'reading', 'finished']);
    assert.deepEqual(enumOptions('format')[1], { value: 'ebook', label: 'Digital' });
  });
});
