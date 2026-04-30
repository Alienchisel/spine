// authors: [{id, name}] or [string]
export function formatAuthors(authors) {
  if (!authors?.length) return null;
  const names = authors.map(a => (typeof a === 'string' ? a : a.name));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]} et al.`;
}

export function sortTitle(title) {
  return (title || '').replace(/^(the|a|an)\s+/i, '');
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
