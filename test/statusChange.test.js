import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyStatusChange } from '../client/src/components/bookForm/statusChange.js';

// The edit form's Status select (client/src/components/bookForm/statusChange.js).
const TODAY = '2026-10-03';
const savedFrom = (f) => ({ status: f.status, date_started: f.date_started, date_finished: f.date_finished, read_count: f.read_count });
const walk = (form, saved, ...statuses) => statuses.reduce((f, s) => applyStatusChange(f, s, saved, TODAY), form);

describe('edit form: Status select', () => {
  const finished = { status: 'finished', date_started: '2026-04-16', date_finished: '2026-04-19', read_count: 1, previously_owned: false };

  it('finished → reading → finished restores the saved read dates', () => {
    // Regression: the round trip saved today–today over the past read.
    const out = walk(finished, savedFrom(finished), 'reading', 'finished');
    assert.deepEqual([out.date_started, out.date_finished, out.read_count], ['2026-04-16', '2026-04-19', 1]);
  });

  it('finished → unread → finished keeps the saved finish date', () => {
    const out = walk(finished, savedFrom(finished), 'unread', 'finished');
    assert.equal(out.date_finished, '2026-04-19');
  });

  it('a re-read in progress → finished → reading keeps the earlier read’s finish date', () => {
    // Regression: the round trip blanked date_finished, and the server
    // cleared the previous completed read's finish.
    const reading = { status: 'reading', date_started: TODAY, date_finished: '2026-06-13', read_count: 1, previously_owned: false };
    const out = walk(reading, savedFrom(reading), 'finished', 'reading');
    assert.deepEqual([out.date_started, out.date_finished], [TODAY, '2026-06-13']);
  });

  it('unread → finished → unread undoes the read_count bump', () => {
    const unread = { status: 'unread', date_started: '', date_finished: '', read_count: 0, previously_owned: false };
    const mid = walk(unread, savedFrom(unread), 'finished');
    assert.equal(mid.read_count, 1);
    assert.equal(mid.date_finished, TODAY);
    const out = walk(mid, savedFrom(unread), 'unread');
    assert.deepEqual([out.read_count, out.date_finished], [0, '']);
  });

  it('real transitions still fill in dates from the saved status', () => {
    const s = savedFrom(finished);
    const reread = walk(finished, s, 'reading');
    assert.deepEqual([reread.date_started, reread.date_finished], [TODAY, '']);
    const reading = { status: 'reading', date_started: '2026-09-01', date_finished: '', read_count: 0, previously_owned: false };
    const done = walk(reading, savedFrom(reading), 'finished');
    assert.deepEqual([done.date_started, done.date_finished, done.read_count], ['2026-09-01', TODAY, 1]);
  });

  it('a typed date survives status changes', () => {
    const typed = { ...finished, date_finished: '2026-05-01' };
    const out = walk(typed, savedFrom(finished), 'reading', 'finished');
    assert.equal(out.date_finished, '2026-05-01');
  });

  it('previously-owned books are not given a today finish', () => {
    const prev = { status: 'unread', date_started: '', date_finished: '2019-02-01', read_count: 1, previously_owned: true };
    assert.equal(walk(prev, savedFrom(prev), 'finished').date_finished, '2019-02-01');
  });

  it('the add form (no saved book) keeps the previous-value behaviour', () => {
    const fresh = { status: 'unread', date_started: '', date_finished: '', read_count: 0, previously_owned: false };
    const out = walk(fresh, null, 'reading', 'finished');
    assert.deepEqual([out.date_started, out.date_finished, out.read_count], [TODAY, TODAY, 1]);
  });
});
