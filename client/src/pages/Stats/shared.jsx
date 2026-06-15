import { Link } from 'react-router-dom';
import { initialsFor, formatYear } from '../../utils.js';

// Anywhere a Link out of Stats wants the back-button to land on this page,
// pass `state={FROM_STATS}` so the destination's "← Back" restores the
// referrer correctly. Hoisted here so every section can reach the same
// frozen reference without prop-drilling.
export const FROM_STATS = { from: 'Stats', fromPath: '/stats' };

// Section heading wrapper used by every Stats section. The optional
// `action` slot is for a right-aligned "All tags →" / "View as collage →"
// link that sits on the same row as the title.
export function Section({ title, children, action }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

// Compact card with a big number, small descriptor underneath, and an
// optional sub-line. Used for the Library tiles, Reading averages, and
// any "one number" tile that wants to be clickable.
export function StatCard({ label, value, sub, href }) {
  const inner = (
    <>
      <div className="text-2xl font-semibold text-parchment">{value ?? '—'}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-neutral-600 mt-1">{sub}</div>}
    </>
  );
  return href
    ? <Link to={href} state={FROM_STATS} className="bg-card rounded-lg p-4 block hover:ring-1 hover:ring-neutral-600 transition-shadow">{inner}</Link>
    : <div className="bg-card rounded-lg p-4">{inner}</div>;
}

// Horizontal bar: label on the left, oak-tinted bar in the middle, count
// or caption on the right. Used by every bar-list section (Days read,
// Finished by year, Ratings, Top authors, etc.). The width-28 label
// column keeps every list visually aligned.
export function Bar({ label, count, max, color = 'bg-oak', href, caption }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  // Tooltip pairs the label with the bar's value. Prefer the explicit
  // `caption` ("12 books" / "3 authors") when the caller supplied one
  // so the hover text matches the polished row-end caption; fall back
  // to the raw count when no caption was given.
  const tooltip = caption
    ? `${label} · ${caption}`
    : count != null ? `${label} · ${count.toLocaleString()}` : label;
  const labelEl = href
    ? <Link to={href} state={FROM_STATS} className="text-xs text-neutral-400 w-28 flex-shrink-0 truncate hover:text-parchment transition-colors" title={tooltip}>{label}</Link>
    : <span className="text-xs text-neutral-400 w-28 flex-shrink-0 truncate" title={tooltip}>{label}</span>;
  return (
    <div className="flex items-center gap-3">
      {labelEl}
      <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs text-neutral-500 text-right tabular-nums whitespace-nowrap ${caption ? '' : 'w-8'}`}>
        {caption ?? count}
      </span>
    </div>
  );
}

// Record-card shape used by the Records section: tiny cover thumbnail,
// label (e.g. "Longest read"), book title, and a value line (page count
// or duration). Always a Link to the book's detail page.
export function RecordCard({ label, book, value }) {
  if (!book) return null;
  return (
    <Link to={`/books/${book.id}`} state={FROM_STATS} className="bg-card rounded-lg p-3 flex items-center gap-3 hover:ring-1 hover:ring-neutral-600 transition-shadow">
      <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {book.cover_path
          ? <img src={book.cover_path} alt="" className="w-full h-full object-cover object-top" />
          : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-[10px] text-neutral-500 font-medium tracking-wide">{initialsFor(book.title)}</div>}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-neutral-500 mb-0.5">{label}</p>
        <p className="text-xs font-medium text-neutral-200 truncate">{book.title}</p>
        {value && <p className="text-xs text-neutral-600 mt-0.5">{value}</p>}
      </div>
    </Link>
  );
}

// "1,234h 56m" / "12h" formatter for audiobook record cards. Minutes
// hidden when zero so a clean-hour record reads cleanly.
export function formatHours(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h.toLocaleString()}h ${m}m` : `${h.toLocaleString()}h`;
}

// For the Oldest/Newest edition record cards. Books are ranked server-side
// by COALESCE(year_edition, year_published), so display the same year and
// label it according to which one was used — otherwise a 2020 reprint of a
// 1600 work shows as "newest edition" but reads "Published 1600."
export function editionRecordValue(book) {
  if (!book) return null;
  const y = book.year_edition ?? book.year_published;
  if (y == null) return null;
  return `${book.year_edition ? 'Edition' : 'Published'} ${formatYear(y)}`;
}
