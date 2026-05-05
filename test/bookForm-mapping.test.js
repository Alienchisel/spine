// Regression test for the BookForm round-trip wipe bug discovered in 1.20.0
// bug-sweep. bookToFormState used to omit `loved`, `archived`, and `is_stub`,
// so the form's `form.X` was undefined; formStateToPayload propagated that,
// the PUT body had no key, and the backend's `payload.X ? 1 : 0` wrote 0.
// Net effect: every BookForm save silently wiped these flags.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bookToFormState, formStateToPayload } from '../client/src/components/bookForm/mapping.js';
import { BOOK_TABLE_COLUMNS } from '../shared/bookFields.js';

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

  it('every BOOK_TABLE_COLUMNS field is present in the form payload (gap-detector)', () => {
    // Structural lock-down: any column in BOOK_TABLE_COLUMNS that's not in
    // the form payload will be silently wiped on save (the bug class that
    // hit `loved` for years and `archived` on day one of 1.20). Adding a
    // column to BOOK_TABLE_COLUMNS without adding it to bookToFormState
    // should fail this test, not slip through to production.
    const fullyPopulatedBook = {
      title: 'Coverage Test', status: 'reading',
      owned: 1, previously_owned: 0, is_custom: 0, is_stub: 0, loved: 1,
      fiction: 1, source_type: null,
      cover_path: '/uploads/x.jpg', rating: 4,
      date_started: '2024-01-01', date_finished: null,
      acquisition_source: 'Amazon', acquisition_date: '2024',
      format: 'physical', binding: 'paperback', condition: 'good',
      description: 'd', notes: 'n', review: 'r',
      page_count: 200, duration_minutes: null,
      publisher: 'P', series: 'S', series_number: 1,
      isbn_10: '0123456789', isbn_13: '9780123456786', asin: 'B000000001',
      language: 'English', original_language: null,
      year_published: 2000, year_approximate: 0, year_edition: 2010,
      abridged: 0, archived: 0,
      shelf_id: null, building_id: null, room_id: null, unit_id: null,
      authors: [{ id: 1, name: 'A' }], narrators: [], translators: [], tags: [],
    };

    const form = bookToFormState(fullyPopulatedBook);
    const payload = formStateToPayload(form, {
      tagInput: '', narratorInput: '', authorInput: '', translatorInput: '',
    });

    const missing = BOOK_TABLE_COLUMNS.filter(col => payload[col] === undefined);
    assert.deepEqual(missing, [],
      `BOOK_TABLE_COLUMNS field(s) missing from form payload — backend will silently wipe these on PUT: ${missing.join(', ')}`);
  });
});
