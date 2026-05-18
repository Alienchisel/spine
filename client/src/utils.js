// Generic person-list formatter — used for authors, narrators, and
// translators (all share the [{id, name}] | [string] shape). Returns null
// for empty input, the bare name for one, "A & B" for two, "A, B & C" for
// three, and "A et al." for four or more.
export function formatAuthors(authors) {
  if (!authors?.length) return null;
  const names = authors.map(a => (typeof a === 'string' ? a : a.name));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]} et al.`;
}

// Renders a year integer as "1965" or "800 BCE". Returns '' for null/undefined.
// year 0 is invalid (rejected at validation), so we don't handle it specially.
export function formatYear(y) {
  if (y == null) return '';
  return y > 0 ? String(y) : `${-y} BCE`;
}

export function sortTitle(title) {
  return (title || '').replace(/^(the|a|an)\s+/i, '');
}

// "5 books", "1 book". Default pluralForm appends "s"; pass an explicit
// override for irregulars (shelves, matches, etc.).
export function plural(n, singular, pluralForm) {
  return `${n} ${pluralWord(n, singular, pluralForm)}`;
}

// Just the noun, no count — for label slots like <Row label="Narrators">
// where the count lives elsewhere in the row.
export function pluralWord(n, singular, pluralForm) {
  return n === 1 ? singular : (pluralForm ?? singular + 's');
}

export function realTagNames(tags) {
  return (tags ?? []).filter(t => !t.virtual).map(t => t.name);
}

// Formats a YYYY-MM-DD into "12 Apr" (same year) or "12 Apr 2024" (otherwise).
// Used by Diary tooltip and Stats streak captions; noon offsets the parsed
// Date so DST/TZ rounding doesn't bump the day either way.
export function fmtShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Formats a YYYY-MM into "Apr 2026". Used by Stats monthly-streak ranges.
export function fmtShortMonth(yearMonthStr) {
  if (!yearMonthStr) return '';
  const [y, m] = yearMonthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

// Converts an ISO-week identifier ("2026-W17") to the Monday-of-that-week
// YYYY-MM-DD string, then formats it via fmtShortDate. ISO 8601 week 1 is
// the week containing the year's first Thursday (equivalently: Jan 4).
export function fmtIsoWeekMonday(isoWeekStr) {
  if (!isoWeekStr) return '';
  const [yStr, wStr] = isoWeekStr.split('-W');
  const year = parseInt(yStr);
  const week = parseInt(wStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);
  return fmtShortDate(monday.toISOString().slice(0, 10));
}

// Modifier-key glyph for the user's platform — '⌘' on macOS/iOS,
// 'Ctrl' everywhere else (Windows/Linux/Android). Used to render
// keyboard-shortcut hints correctly; the underlying handlers all
// accept e.ctrlKey || e.metaKey regardless of platform.
export const MOD_KEY = (() => {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘' : 'Ctrl';
})();

// Up to 3-letter initials for skeleton tiles / covers / portraits when
// the image is missing. Strips a leading article ("the", "a", "an") on
// titles so "The Dispossessed" → "D" not "T". Mononyms ("Plato") fall
// through as one letter. Used everywhere a book cover or author
// portrait can be absent — keeps the placeholder informative without
// requiring the layout to also render a text label.
export function initialsFor(label) {
  if (!label) return '·';
  const stripped = label.replace(/^(the|a|an)\s+/i, '');
  const tokens = stripped.split(/\s+/).filter(Boolean);
  const letters = tokens.map(t => t[0]).filter(c => /[A-Za-z]/.test(c)).slice(0, 3);
  return letters.length ? letters.join('').toUpperCase() : (stripped[0] || '·');
}
