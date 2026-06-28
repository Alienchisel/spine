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

// Cross-format activity unit, in pages. Print/ebook sessions store
// pages_read directly. Audiobook sessions store minutes_read; the
// per-session page equivalent derives proportionally from the book's
// total page_count and duration_minutes:
//   audiobook_pages = minutes_read × page_count / duration_minutes
// This replaces an older pages × 2 + minutes composite which baked
// in a magic 2-min-per-page constant. Now both formats are compared
// in raw pages — assuming the user has filled page_count on audiobooks
// (which is a user-maintained print-equivalent size). Audiobook
// sessions on books without page_count contribute 0 (NULL via
// NULLIF, COALESCE'd out).
const ACTIVITY = `(rl.pages_read + COALESCE(rl.minutes_read * b.page_count * 1.0 / NULLIF(b.duration_minutes, 0), 0))`;

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

// Server-side mirror of utils.js formatPartialDate. Renders YYYY /
// YYYY-MM / YYYY-MM-DD as "1893" / "July 1893" / "18 July 1893" so
// the recently_finished and year_in_review tile sublabels read as
// dates instead of raw ISO strings.
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function formatPartialDate(val) {
  if (!val) return null;
  const parts = String(val).split('-');
  if (parts.length === 1) return parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const monthName = MONTH_NAMES[monthIdx] ?? parts[1];
  if (parts.length === 2) return `${monthName} ${parts[0]}`;
  return `${parseInt(parts[2], 10)} ${monthName} ${parts[0]}`;
}

// "Top authors by aggregate activity across their books in the
// period." Co-authored books contribute fully to each author (matches
// last.fm's "artist play" semantics — a track with two artists counts
// for both). Activity is in pages (audiobook minutes converted via
// page_count / duration_minutes per session); sublabel renders pages
// so the unit matches the ranking, with a book-count footnote for
// context.
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
    sublabel: `${Math.round(r.activity).toLocaleString()} pages · ${r.book_count} ${r.book_count === 1 ? 'book' : 'books'}`,
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
  // effective_date_finished = MAX(reads.date_finished) ?? books.date_finished.
  // The book-column fallback covers Phase-2-transition books with a date
  // on the row but no reads row; Phase 3 drops it.
  const rows = db.prepare(`
    SELECT b.id, b.title, b.cover_path,
      COALESCE((SELECT MAX(date_finished) FROM reads WHERE reads.book_id = b.id), b.date_finished) AS effective_date_finished
      FROM books b
     WHERE b.status = 'finished'
       AND COALESCE((SELECT MAX(date_finished) FROM reads WHERE reads.book_id = b.id), b.date_finished) IS NOT NULL
     ORDER BY effective_date_finished DESC, b.title ASC
     LIMIT ?
  `).all(limit);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: formatPartialDate(r.effective_date_finished),
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
  // LIKE 'YYYY%' (not a date range) so year-precision partial-date finishes
  // (e.g. date_finished = '2019') still appear in their collage — a range
  // filter like '2019-01-01' <= x <= '2019-12-31' silently excludes them
  // because '2019' < '2019-01-01' lexically. The substr year-bucket stats
  // already counted those finishes; the collage should match.
  // A book is "in" a calendar year if any reads row finished in that
  // year OR the book column matches (Phase 2 transition fallback). For
  // the sublabel we surface the matching read's date when one exists,
  // falling back to the book column. Books finished multiple times in
  // the same year still show once — duplicate covers in a year-in-
  // review collage would feel weird; the per-read history is on
  // BookDetail.
  const rows = db.prepare(`
    SELECT b.id, b.title, b.cover_path,
      COALESCE(
        (SELECT MIN(date_finished) FROM reads WHERE reads.book_id = b.id AND date_finished LIKE ?),
        CASE WHEN b.date_finished LIKE ? THEN b.date_finished END
      ) AS effective_date_finished
      FROM books b
     WHERE b.status = 'finished'
       AND (
         EXISTS (SELECT 1 FROM reads WHERE reads.book_id = b.id AND date_finished LIKE ?)
         OR b.date_finished LIKE ?
       )
     ORDER BY effective_date_finished ASC, b.title ASC
     LIMIT 1000
  `).all(`${year}%`, `${year}%`, `${year}%`, `${year}%`);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: formatPartialDate(r.effective_date_finished),
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
