// Defends the progress-input mode hydration in BookCard / ProgressSection.
// A stored mode can drift out of the format-appropriate set when the user
// flips a book's format (a per-book key sticks around even though 'page'
// is no longer valid for an audiobook), and hand-edited localStorage can
// supply anything.

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
    assert.equal(initialProgressMode(null,      true),  'min');
    assert.equal(initialProgressMode(null,      false), 'page');
    assert.equal(initialProgressMode(undefined, true),  'min');
    assert.equal(initialProgressMode('',        false), 'page');
  });

  it('preserves a valid audiobook mode', () => {
    assert.equal(initialProgressMode('min',       true), 'min');
    assert.equal(initialProgressMode('remaining', true), 'remaining');
    assert.equal(initialProgressMode('pct',       true), 'pct');
  });

  it('preserves a valid non-audiobook mode', () => {
    assert.equal(initialProgressMode('page', false), 'page');
    assert.equal(initialProgressMode('pct',  false), 'pct');
  });

  it('clamps a stale cross-format mode (book flipped to audiobook)', () => {
    // A user changes a paperback to its audiobook edition. The
    // localStorage key for that book id still has 'page', which isn't
    // a valid audiobook mode — the helper restores the default.
    assert.equal(initialProgressMode('page', true), 'min');
  });

  it('clamps a stale cross-format mode (book flipped from audiobook)', () => {
    assert.equal(initialProgressMode('remaining', false), 'page');
    assert.equal(initialProgressMode('min',       false), 'page');
  });

  it('rejects unknown strings', () => {
    assert.equal(initialProgressMode('chapter', true),  'min');
    assert.equal(initialProgressMode('chapter', false), 'page');
    assert.equal(initialProgressMode('list',    false), 'page');
  });

  it('rejects non-string saved values', () => {
    assert.equal(initialProgressMode(42,        true),  'min');
    assert.equal(initialProgressMode({},        false), 'page');
    assert.equal(initialProgressMode(['page'],  false), 'page');
    assert.equal(initialProgressMode(true,      true),  'min');
  });
});
