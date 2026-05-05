// Regression test for the BookForm round-trip wipe bug discovered in 1.20.0
// bug-sweep. bookToFormState used to omit `loved`, `archived`, and `is_stub`,
// so the form's `form.X` was undefined; formStateToPayload propagated that,
// the PUT body had no key, and the backend's `payload.X ? 1 : 0` wrote 0.
// Net effect: every BookForm save silently wiped these flags.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bookToFormState, formStateToPayload } from '../client/src/components/bookForm/mapping.js';

describe('BookForm mapping: round-trip preservation', () => {
  it('bookToFormState preserves loved, archived, and is_stub from the API shape', async () => {
    const book = {
      title: 'Test',
      loved: 1,
      archived: 1,
      is_stub: 1,
      previously_owned: 1,
      authors: [{ id: 1, name: 'X' }],
      tags: [], narrators: [], translators: [],
      fiction: 1, status: 'unread', owned: 0,
    };
    const form = bookToFormState(book);
    assert.equal(form.loved, true,    'loved must be in form state');
    assert.equal(form.archived, true, 'archived must be in form state');
    assert.equal(form.is_stub, true,  'is_stub must be in form state');
  });

  it('formStateToPayload propagates the flags so PUT carries them', () => {
    const form = bookToFormState({
      title: 'Test', loved: 1, archived: 0, is_stub: 0,
      authors: [{ id: 1, name: 'X' }], tags: [], narrators: [], translators: [],
    });
    const payload = formStateToPayload(form, {
      tagInput: '', narratorInput: '', authorInput: '', translatorInput: '',
    });
    assert.equal(payload.loved, true);
    assert.equal(payload.archived, false);
    assert.equal(payload.is_stub, false);
  });

  it('round-trips loved=0/archived=0 as `false` (not undefined)', () => {
    // The wipe used to surface as `false` working but `true` getting reset to
    // `false`. The fix must produce explicit booleans either way so the API
    // payload always carries the field.
    const form = bookToFormState({
      title: 'Test', loved: 0, archived: 0, is_stub: 0,
      authors: [], tags: [], narrators: [], translators: [],
    });
    assert.equal(form.loved, false);
    assert.equal(form.archived, false);
    assert.equal(form.is_stub, false);
    assert.notEqual(form.loved, undefined);
    assert.notEqual(form.archived, undefined);
    assert.notEqual(form.is_stub, undefined);
  });
});
