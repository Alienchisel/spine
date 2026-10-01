import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../scripts/lib/csv.js';

// scripts/lib/csv.js backs the Audible / Kindle import scripts.
describe('parseCsv', () => {
  it('splits rows and fields, with CRLF line endings', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });

  it('handles quoted commas, doubled quotes and newlines inside quotes', () => {
    assert.deepEqual(
      parseCsv('title,note\n"Dune, Part One","He said ""hi""\nthen left"\n'),
      [['title', 'note'], ['Dune, Part One', 'He said "hi"\nthen left']],
    );
  });

  it('keeps a last row with no trailing newline, and empty fields', () => {
    assert.deepEqual(parseCsv('a,,c\nx,y,'), [['a', '', 'c'], ['x', 'y', '']]);
  });

  it('strips a leading byte-order mark so the first header matches', () => {
    const [header] = parseCsv('﻿Date,ASIN\n2026-01-01,B00X\n');
    assert.equal(header[0], 'Date');
  });
});
