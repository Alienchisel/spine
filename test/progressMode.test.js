// Defends the progress-input mode hydration in BookCard / ProgressSection.
// A stored mode can drift out of the format-appropriate set when the user
// flips a book's format (a per-book key sticks around even though 'page'
// is no longer valid for an audiobook), drift out of the hasPct-gated
// set when page_count / duration_minutes is cleared after the user
// already picked 'pct' or 'remaining', or be hand-edited to anything.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getModeKey, initialProgressMode } from '../client/src/components/progressMode.js';

describe('getModeKey', () => {
  it('namespaces by book id', () => {
    assert.equal(getModeKey(42),  'spine-progress-mode-42');
    assert.equal(getModeKey(123), 'spine-progress-mode-123');
  });
});

describe('initialProgressMode', () => {
  it('falls back to default when nothing is saved', () => {
    assert.equal(initialProgressMode(null,      true,  true),  'min');
    assert.equal(initialProgressMode(null,      false, true),  'page');
    assert.equal(initialProgressMode(undefined, true,  false), 'min');
    assert.equal(initialProgressMode('',        false, false), 'page');
  });

  it('preserves a valid audiobook mode when hasPct is true', () => {
    assert.equal(initialProgressMode('min',       true, true), 'min');
    assert.equal(initialProgressMode('remaining', true, true), 'remaining');
    assert.equal(initialProgressMode('pct',       true, true), 'pct');
  });

  it('preserves a valid non-audiobook mode when hasPct is true', () => {
    assert.equal(initialProgressMode('page', false, true), 'page');
    assert.equal(initialProgressMode('pct',  false, true), 'pct');
  });

  it('clamps a stale cross-format mode (book flipped to audiobook)', () => {
    // A user changes a paperback to its audiobook edition. The
    // localStorage key for that book id still has 'page', which isn't
    // a valid audiobook mode — the helper restores the default.
    assert.equal(initialProgressMode('page', true, true), 'min');
  });

  it('clamps a stale cross-format mode (book flipped from audiobook)', () => {
    assert.equal(initialProgressMode('remaining', false, true), 'page');
    assert.equal(initialProgressMode('min',       false, true), 'page');
  });

  it('rejects pct on a book without a known total', () => {
    // hasPct=false means the <select> won't render the 'pct' option;
    // a stored 'pct' would otherwise leave React state out of sync
    // with the visible dropdown. Default for the format wins.
    assert.equal(initialProgressMode('pct', false, false), 'page');
    assert.equal(initialProgressMode('pct', true,  false), 'min');
  });

  it('rejects remaining on an audiobook without a known duration', () => {
    // 'remaining' is gated on hasPct in the dropdown the same way 'pct'
    // is — needs the total to compute "h/m left."
    assert.equal(initialProgressMode('remaining', true, false), 'min');
  });

  it('always allows the format default regardless of hasPct', () => {
    assert.equal(initialProgressMode('min',  true,  false), 'min');
    assert.equal(initialProgressMode('page', false, false), 'page');
  });

  it('rejects unknown strings', () => {
    assert.equal(initialProgressMode('chapter', true,  true), 'min');
    assert.equal(initialProgressMode('chapter', false, true), 'page');
    assert.equal(initialProgressMode('list',    false, true), 'page');
  });

  it('rejects non-string saved values', () => {
    assert.equal(initialProgressMode(42,        true,  true),  'min');
    assert.equal(initialProgressMode({},        false, true),  'page');
    assert.equal(initialProgressMode(['page'],  false, true),  'page');
    assert.equal(initialProgressMode(true,      true,  true),  'min');
  });
});
