import db from '../../db.js';
import { toCoverUrl } from '../books/normalization.js';

// Period → SQLite-comparable date-string clause. Returns null for 'all'
// so the caller can skip the date filter entirely. The reading_log
// stores dates as ISO YYYY-MM-DD TEXT, so string comparisons work.
const PERIOD_DAYS = {
  '7d':   7,
  '30d':  30,
  '90d':  90,
  '180d': 180,
  '365d': 365,
};
export const ALLOWED_PERIODS = Object.freeze(['7d', '30d', '90d', '180d', '365d', 'all']);
export const ALLOWED_MODES   = Object.freeze([
  'top_books', 'top_authors', 'recently_finished',
  'year_in_review',
]);

function periodStart(period) {
  if (period === 'all') return null;
  const days = PERIOD_DAYS[period];
  if (days == null) return null;
  return db.prepare("SELECT date('now', 'localtime', '-' || ? || ' days') AS d").get(days).d;
}

// Cross-format activity unit, in minutes. Pages are converted at
// MIN_PER_PAGE = 2 minutes/page (roughly average reading speed: ~250
// words/page at ~125 words/minute). Each reading_log row stores ONE
// of pages or minutes (the other is 0), so the linear expression
// works without a CASE. Without the conversion, audiobooks dominated
// the ranking because raw minutes >> raw page counts on a per-book
// basis. The constant is a deliberately middle-of-the-road estimate;
// dense non-fiction or fast genre reading vary in either direction
// but 2 min/page brings the two formats into the same order of
// magnitude.
const MIN_PER_PAGE = 2;
const ACTIVITY = `(pages_read * ${MIN_PER_PAGE} + minutes_read)`;

// "Top books by reading-log activity in the period." Returns up to N
// tiles where N = size*size, sorted by activity DESC with title as
// the stable tiebreaker so two same-activity sessions render in a
// consistent order.
function topBooks(start, limit) {
  const where = start ? 'WHERE rl.date >= ?' : '';
  const params = start ? [start, limit] : [limit];
  const rows = db.prepare(`
    SELECT b.id, b.title, b.cover_path, b.format,
           SUM(rl.pages_read) AS pages, SUM(rl.minutes_read) AS minutes,
           SUM(${ACTIVITY}) AS activity
      FROM reading_log rl
      JOIN books b ON b.id = rl.book_id
      ${where}
     GROUP BY b.id
     HAVING activity > 0
     ORDER BY activity DESC, b.title ASC
     LIMIT ?
  `).all(...params);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    // Data-driven instead of format-driven: show whichever value is
    // actually non-zero. A book whose format says 'ebook' but whose
    // reading_log was logged in minutes (e.g. a long pamphlet read as
    // a podcast) would otherwise display '0 pages'.
    sublabel: r.pages > 0
      ? `${r.pages.toLocaleString()} pages`
      : formatMinutes(r.minutes),
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// Mirror Diary's formatMinutes: "2h 30m" / "2h" / "45m". Long audiobooks
// would otherwise show "856 min" in tooltips, which is hard to read at
// a glance.
function formatMinutes(min) {
  if (!min) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// "Top authors by aggregate activity across their books in the
// period." Co-authored books contribute fully to each author (matches
// last.fm's "artist play" semantics — a track with two artists counts
// for both). Activity is already in minutes (pages × MIN_PER_PAGE +
// minutes_read) so the sublabel can render the same time format as
// top_books — keeps the tooltip in the same unit as the ranking, with
// a book-count footnote for context.
function topAuthors(start, limit) {
  const where = start ? 'WHERE rl.date >= ?' : '';
  const params = start ? [start, limit] : [limit];
  const rows = db.prepare(`
    SELECT a.id, a.name, a.photo_path,
           SUM(${ACTIVITY})        AS activity,
           COUNT(DISTINCT b.id)    AS book_count
      FROM reading_log rl
      JOIN books b ON b.id = rl.book_id
      JOIN book_authors ba ON ba.book_id = b.id
      JOIN authors a ON a.id = ba.author_id
      ${where}
     GROUP BY a.id
     HAVING activity > 0
     ORDER BY activity DESC, a.name ASC
     LIMIT ?
  `).all(...params);
  return rows.map(r => ({
    id:       r.id,
    label:    r.name,
    sublabel: `${formatMinutes(r.activity)} · ${r.book_count} ${r.book_count === 1 ? 'book' : 'books'}`,
    image:    r.photo_path,
    href:     `/authors/${r.id}`,
  }));
}

// "The N most-recently-finished books, whenever they were finished."
// No period filter — adding one would let an arbitrary cutoff swallow
// the answer (e.g. "Last 7 days" returns 0 if the user didn't finish
// anything this week). Sorted by date_finished DESC with title as
// the deterministic tiebreaker for same-day finishes.
function recentlyFinished(limit) {
  const rows = db.prepare(`
    SELECT id, title, cover_path, date_finished
      FROM books
     WHERE status = 'finished' AND date_finished IS NOT NULL
     ORDER BY date_finished DESC, title ASC
     LIMIT ?
  `).all(limit);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: r.date_finished,
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// "Every book finished during a specific calendar year." Filters by
// date_finished (the actual completion stamp), not reading-log
// activity — so a book that was read all of December 2024 but finished
// in January 2025 lands in the 2025 review, not 2024. Locking to
// Jan 1 → Dec 31 keeps the January retrospective honest. Returns
// every match (capped at a generous 1000 as a sanity guard); the
// client auto-sizes the grid columns to fit whatever count comes
// back, ignoring the size param it would otherwise pass.
function yearInReview(year) {
  if (!year) return [];
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;
  const rows = db.prepare(`
    SELECT id, title, cover_path, date_finished
      FROM books
     WHERE status = 'finished'
       AND date_finished IS NOT NULL
       AND date_finished >= ?
       AND date_finished <= ?
     ORDER BY date_finished ASC, title ASC
     LIMIT 1000
  `).all(start, end);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: r.date_finished,
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// Facets for the year_in_review picker. Only years with reading-log
// activity show up so the dropdown isn't padded with empty options.
export function getCollageFacets() {
  const years = db.prepare(`
    SELECT DISTINCT substr(date, 1, 4) AS year
      FROM reading_log
     ORDER BY year DESC
  `).all().map(r => r.year);
  return { years };
}

export function computeCollage({ mode, period, size, year }) {
  const start = periodStart(period);
  const limit = size * size;
  let tiles;
  switch (mode) {
    case 'top_books':         tiles = topBooks(start, limit);         break;
    case 'top_authors':       tiles = topAuthors(start, limit);       break;
    case 'recently_finished': tiles = recentlyFinished(limit);        break;
    case 'year_in_review':    tiles = yearInReview(year);             break;
    default: throw new Error(`Unknown collage mode: ${mode}`);
  }
  return { mode, period, size, year: year ?? null, tiles };
}
