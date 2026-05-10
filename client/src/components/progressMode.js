// Persisted-state shape guard for the progress-input mode that
// BookCard and bookDetail/ProgressSection both store per-book in
// localStorage. The valid set depends on book.format:
//   - audiobook:    'min' | 'remaining' | 'pct'
//   - everything else: 'page' | 'pct'
//
// A stored mode can fall outside the current set when the user flips
// the book's format (e.g. swapping a physical record to its audiobook
// edition); without this clamp, the form's React state holds (say)
// 'page' while the rendered <select> has no matching option, and the
// dropdown silently mismatches state. Mirrors the typeof / whitelist
// guards on the Library hydration path.

const VALID_AUDIO_MODES = new Set(['min', 'remaining', 'pct']);
const VALID_PAGE_MODES  = new Set(['page', 'pct']);

export function getModeKey(bookId) {
  return `spine-progress-mode-${bookId}`;
}

export function initialProgressMode(saved, isAudiobook) {
  const valid = isAudiobook ? VALID_AUDIO_MODES : VALID_PAGE_MODES;
  if (typeof saved === 'string' && valid.has(saved)) return saved;
  return isAudiobook ? 'min' : 'page';
}
