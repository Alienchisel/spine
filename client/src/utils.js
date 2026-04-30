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
