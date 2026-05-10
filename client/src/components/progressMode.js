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
