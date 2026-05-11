// Persisted-state shape guard for the progress-input mode that
// BookCard and bookDetail/ProgressSection both store per-book in
// localStorage. The valid set depends on book.format AND on whether
// the book has a known total (page_count for non-audio, duration_minutes
// for audio):
//   - audiobook + hasPct:  'min' | 'remaining' | 'pct'
//   - audiobook only:      'min'
//   - other + hasPct:      'page' | 'pct'
//   - other only:          'page'
//
// A stored mode can fall outside the current set when the user flips
// the book's format (per-book key still has 'page' for a now-audiobook),
// or when 'pct' / 'remaining' was selected while page_count was set
// and that field has since been cleared — the rendered <select> only
// emits the 'pct' / 'remaining' options when hasPct is true, so without
// this clamp the form's React state holds a mode the dropdown can't
// show. Mirrors the typeof / whitelist guards on the Library
// hydration path.

const VALID_AUDIO_MODES = new Set(['min', 'remaining', 'pct']);
const VALID_PAGE_MODES  = new Set(['page', 'pct']);
const REQUIRES_PCT      = new Set(['pct', 'remaining']);

export function getModeKey(bookId) {
  return `spine-progress-mode-${bookId}`;
}

export function initialProgressMode(saved, isAudiobook, hasPct) {
  const valid = isAudiobook ? VALID_AUDIO_MODES : VALID_PAGE_MODES;
  const ok = typeof saved === 'string'
    && valid.has(saved)
    && (!REQUIRES_PCT.has(saved) || hasPct);
  if (ok) return saved;
  return isAudiobook ? 'min' : 'page';
}

// Normalise a progress-input submission into a PATCH body. Both
// BookCard and bookDetail/ProgressSection have the same submit
// shape (4 modes × audiobook/page) — keeping the math here lets the
// next edge-case fix (a clamp tweak, a new mode) happen once.
//
// Returns { patchData } on success or { error } on failure; the
// caller wires `error` into its setError + early-return without a
// try/catch. The compute step is intentionally pure: no spinner,
// no network, no setState — that's left to the caller's in-flight
// guard.
//
// Both axes clamp to [0, total] when total is known, falling back to
// max(0, ...) when it isn't. Server-side PATCH enforces the same
// bounds; the clamp here prevents the round-trip error that an
// out-of-range typo would otherwise produce.
export function computeProgressPatch({ book, isAudiobook, mode, inputVal, inputH, inputM }) {
  if (isAudiobook) {
    const enteredMinutes = (parseInt(inputH) || 0) * 60 + (parseInt(inputM) || 0);
    let current_minutes;
    if (mode === 'pct') {
      current_minutes = Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.duration_minutes);
    } else if (mode === 'remaining') {
      if (!book.duration_minutes) return { error: 'Duration unknown' };
      current_minutes = Math.max(0, Math.min(book.duration_minutes, book.duration_minutes - enteredMinutes));
    } else {
      current_minutes = Math.max(0, Math.min(book.duration_minutes ?? Infinity, enteredMinutes));
    }
    if (isNaN(current_minutes)) return { error: 'Invalid value' };
    return { patchData: { current_minutes } };
  }
  const current_page = mode === 'pct'
    ? Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.page_count)
    : Math.max(0, Math.min(book.page_count ?? Infinity, parseInt(inputVal)));
  if (isNaN(current_page)) return { error: 'Invalid value' };
  return { patchData: { current_page } };
}
