// Defends isBareShortcut, the gate on the audit wizards' single-key
// shortcuts (1–9/0 pick, S skip, U undo, L link editions). Browser chords
// like Ctrl/⌘+L or Ctrl+1–9 used to fire them too, making destructive
// saves (linking a duplicate cluster, picking a rating) as a side effect.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBareShortcut } from '../client/src/lib/keyboard.js';

const body = { tagName: 'BODY', isContentEditable: false };
const key = (over = {}) => ({ key: 'l', target: body, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...over });

describe('isBareShortcut', () => {
  it('accepts a plain key press on the page', () => {
    assert.equal(isBareShortcut(key()), true);
  });
  for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    it(`rejects the press when ${mod} is held (browser chord)`, () => {
      assert.equal(isBareShortcut(key({ [mod]: true })), false);
    });
  }
  it('rejects auto-repeat from a held key', () => {
    assert.equal(isBareShortcut(key({ repeat: true })), false);
  });
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    it(`rejects typing into ${tagName}`, () => {
      assert.equal(isBareShortcut(key({ target: { tagName, isContentEditable: false } })), false);
    });
  }
  it('rejects contentEditable targets', () => {
    assert.equal(isBareShortcut(key({ target: { tagName: 'DIV', isContentEditable: true } })), false);
  });
});
