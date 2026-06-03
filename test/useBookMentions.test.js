// Covers the @-trigger detection that gates the BookForm description /
// notes / review @-picker (BookForm wave 1.182.1). Tests the pure
// extracted helper so the trigger semantics are pinned without needing
// jsdom or a React renderer.
//
// Regression-bait: the regex is `(?:^|\s)@([^\s@]{0,40})$` — easy to
// break by tweaking the lookbehind or the 40-char cap.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectMention } from '../client/src/hooks/useBookMentions.js';

describe('detectMention', () => {
  describe('basic triggers', () => {
    it('matches @ at start of text', () => {
      assert.deepEqual(detectMention('@foo', 4), { query: 'foo', matchStart: 0 });
    });

    it('matches @ after a space', () => {
      assert.deepEqual(detectMention('see @foo', 8), { query: 'foo', matchStart: 4 });
    });

    it('matches @ after a tab', () => {
      assert.deepEqual(detectMention('see\t@bar', 8), { query: 'bar', matchStart: 4 });
    });

    it('matches @ after a newline', () => {
      assert.deepEqual(detectMention('line one\n@baz', 13), { query: 'baz', matchStart: 9 });
    });

    it('matches bare @ with empty query (just typed @)', () => {
      assert.deepEqual(detectMention('@', 1), { query: '', matchStart: 0 });
    });

    it('matches @ after whitespace with empty query', () => {
      assert.deepEqual(detectMention('hello @', 7), { query: '', matchStart: 6 });
    });
  });

  describe('non-triggers', () => {
    it('returns null for empty string', () => {
      assert.equal(detectMention('', 0), null);
    });

    it('returns null when text has no @', () => {
      assert.equal(detectMention('plain text', 10), null);
    });

    it('rejects @ following a word character (email-style)', () => {
      // user@example — the @ is preceded by a word character, so this
      // is not a mention. Avoids triggering on emails / handles.
      assert.equal(detectMention('user@example', 12), null);
    });

    it('rejects @ following a digit', () => {
      assert.equal(detectMention('a1@foo', 6), null);
    });

    it('rejects @ following punctuation that is a word char in regex sense', () => {
      // Underscore is \w; ensure we don't trigger after it either.
      assert.equal(detectMention('foo_@bar', 8), null);
    });

    it('returns null when query contains a space (mention already ended)', () => {
      assert.equal(detectMention('@foo bar', 8), null);
    });

    it('returns null when query contains a second @', () => {
      assert.equal(detectMention('@foo@bar', 8), null);
    });

    it('returns null when caret is past the mention with more text after', () => {
      // Once the user has typed text after the @query without selecting,
      // the menu should close. Caret is at end of " hello"; the mention
      // is no longer immediately before the caret.
      assert.equal(detectMention('@foo hello', 10), null);
    });
  });

  describe('caret position', () => {
    it('reads the value up to caretPos only', () => {
      // Caret at index 4 → only "@foo" is considered; "bar" after the
      // caret is ignored. This is what lets the user move the caret
      // back into a previous mention.
      assert.deepEqual(detectMention('@foobar', 4), { query: 'foo', matchStart: 0 });
    });

    it('returns null when caret is at 0', () => {
      assert.equal(detectMention('@foo', 0), null);
    });

    it('handles caret moving back inside a mention word', () => {
      // User typed @foobar then moved caret to position 3 (inside foo).
      // The detection sees "@fo" only — still a valid mention.
      assert.deepEqual(detectMention('@foobar', 3), { query: 'fo', matchStart: 0 });
    });
  });

  describe('40-char cap', () => {
    it('matches up to 40 query chars', () => {
      const query40 = 'a'.repeat(40);
      const text = '@' + query40;
      assert.deepEqual(detectMention(text, 41), { query: query40, matchStart: 0 });
    });

    it('does not match 41+ query chars', () => {
      // The cap stops a runaway match from eating an entire paragraph
      // when the user types @ and keeps typing without picking.
      const query41 = 'a'.repeat(41);
      const text = '@' + query41;
      assert.equal(detectMention(text, 42), null);
    });
  });

  describe('matchStart positions', () => {
    it('matchStart points at the @ character (not the first query char)', () => {
      // Important for splicing on select — the replacement text needs
      // to overwrite the `@query`, not just `query`.
      const result = detectMention('hi @world', 9);
      assert.equal(result.matchStart, 3);
      assert.equal('hi @world'[result.matchStart], '@');
    });
  });

  describe('multi-byte / unicode in the query', () => {
    it('accepts non-ASCII chars in the query', () => {
      // [^\s@] is permissive — accepts unicode letters, marks, etc.
      // This lets the user type book titles with diacritics or CJK.
      assert.deepEqual(detectMention('@Jünger', 7), { query: 'Jünger', matchStart: 0 });
      assert.deepEqual(detectMention('@漱石', 3), { query: '漱石', matchStart: 0 });
    });
  });
});
