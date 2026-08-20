// Single source of truth for rendering a partial date — YYYY, YYYY-MM,
// or YYYY-MM-DD — as a human label. Imported by both the client
// (client/src/utils.js re-exports it, so every UI site keeps importing
// from utils.js) and the server (lib/stats/collage.js sublabels). It had
// been reimplemented on each side and the copies had diverged: the
// server version rendered full dates in day-month order ("18 July 1938")
// and mis-parsed BCE years. This canonical form is en-US and BCE-aware —
// see the us-date-order convention.
//
// Output shape:
//   '1938'        → "1938"
//   '1938-07'     → "July 1938"
//   '1938-07-18'  → "July 18, 1938"
//   '-500'        → "500 BCE"
// Non-matching input is returned as-is; null/empty → null.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// JS Date parsing can't represent year-only / month-only / BCE values,
// so we parse and compose manually for all cases — keeps positive and
// BCE branches consistent.
export function formatPartialDate(val) {
  if (!val) return null;
  const m = String(val).match(/^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return String(val);
  const year  = parseInt(m[1], 10);
  const month = m[2] ? parseInt(m[2], 10) : null;
  const day   = m[3] ? parseInt(m[3], 10) : null;
  const yearLabel = year < 0 ? `${-year} BCE` : String(year);
  if (!month) return yearLabel;
  const monthLabel = MONTHS[month - 1] ?? '';
  if (!day) return `${monthLabel} ${yearLabel}`;
  return `${monthLabel} ${day}, ${yearLabel}`;
}
