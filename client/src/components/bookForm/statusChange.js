// What a change of the edit form's Status select does to the fields a
// status change touches (date_started, date_finished, read_count).
//
// The date fields hold the LATEST read's dates, and a transition starts or
// completes a read: finished → reading is a re-read that starts today, and
// moving into finished completes the current read today — except on a
// previously-owned book, whose read is typically historical with an
// unknown date (auto-filling today would fabricate one).
//
// On an edit, transitions are measured from the status the book was SAVED
// with, not the select's previous value, and choosing the saved status
// again restores the saved values. Otherwise a status changed and changed
// back (a mis-click undone) still saved the dates filled in along the way,
// and the server — seeing no status change — wrote them onto the book's
// existing reads, overwriting a past read's dates. A value the user typed
// (neither the saved value nor one this function fills in) is kept.
//
// `saved` is { status, date_started, date_finished, read_count } from the
// loaded book, or null on the add form (no reads yet to protect), where the
// select's previous value is the baseline as before.
export function applyStatusChange(form, status, saved, today) {
  const base = saved ?? form;
  const autoValues = ['', today];
  const keepTyped = (key, computed) => {
    const current = form[key];
    const typed = saved && current !== saved[key] && !autoValues.includes(current);
    return typed ? current : computed;
  };

  if (saved && status === saved.status) {
    const bumped = saved.read_count === 0 && form.read_count === 1;
    return {
      ...form,
      status,
      date_started:  keepTyped('date_started', saved.date_started),
      date_finished: keepTyped('date_finished', saved.date_finished),
      read_count: bumped ? saved.read_count : form.read_count,
    };
  }

  const reread    = status === 'reading' && base.status === 'finished';
  const finishing = status === 'finished' && base.status !== 'finished';
  return {
    ...form,
    status,
    read_count: status === 'finished' && form.read_count === 0 ? 1 : form.read_count,
    date_started: keepTyped('date_started', reread ? today
      : status === 'reading' && !base.date_started ? today : base.date_started),
    date_finished: keepTyped('date_finished', reread ? ''
      : finishing && !form.previously_owned ? today : base.date_finished),
  };
}
