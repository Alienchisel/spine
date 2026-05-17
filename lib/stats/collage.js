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
  'series_spotlight', 'year_in_review',
  'top_loved', 'top_rated',
]);

function periodStart(period) {
  if (period === 'all') return null;
  const days = PERIOD_DAYS[period];
  if (days == null) return null;
  return db.prepare("SELECT date('now', 'localtime', '-' || ? || ' days') AS d").get(days).d;
}

// Cross-format activity unit. Each reading_log row stores ONE of pages
// or minutes (the other is 0), so summing both yields the appropriate
// unit for that row. Comparison across formats mixes apples and
// oranges deliberately — the goal is "what dominated my reading",
// not a normalized cross-format metric. Audiobook minutes will tend
// to look outsized vs. pages on a per-book basis, but that's
// faithful to time-on-task.
const ACTIVITY = '(pages_read + minutes_read)';

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
    sublabel: r.format === 'audiobook'
      ? `${r.minutes.toLocaleString()} min`
      : `${r.pages.toLocaleString()} pages`,
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// "Top authors by aggregate activity across their books in the
// period." Co-authored books contribute fully to each author (matches
// last.fm's "artist play" semantics — a track with two artists counts
// for both). Cross-format ambiguity is sidestepped on the sublabel by
// reporting book-count rather than mixed page/minute totals.
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
    sublabel: `${r.book_count} ${r.book_count === 1 ? 'book' : 'books'}`,
    image:    r.photo_path,
    href:     `/authors/${r.id}`,
  }));
}

// "Books finished in the period." Sorted by date_finished DESC so the
// most recent completion sits top-left. Falls back to title for
// books with the same date_finished. For period='all' we still cap
// at the limit; the user gets the most recent N finishes regardless.
function recentlyFinished(start, limit) {
  const where = start
    ? "WHERE status = 'finished' AND date_finished IS NOT NULL AND date_finished >= ?"
    : "WHERE status = 'finished' AND date_finished IS NOT NULL";
  const params = start ? [start, limit] : [limit];
  const rows = db.prepare(`
    SELECT id, title, cover_path, date_finished
      FROM books
      ${where}
     ORDER BY date_finished DESC, title ASC
     LIMIT ?
  `).all(...params);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: r.date_finished,
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// "All books in a chosen series, ordered by reading order."
// series_number is the primary key; books without a number land last
// (NULL → 9999) with title as the deterministic tiebreaker. Empty
// or unknown series returns no tiles — the caller decides whether
// that's a 400 or a graceful empty state.
function seriesSpotlight(series, limit) {
  if (!series) return [];
  const rows = db.prepare(`
    SELECT id, title, cover_path, series_number
      FROM books
     WHERE series = ?
     ORDER BY COALESCE(series_number, 9999) ASC, title ASC
     LIMIT ?
  `).all(series, limit);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: r.series_number != null ? `#${r.series_number}` : null,
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// "Top books read during a specific calendar year." Distinct from a
// rolling Last-365-days window — locking to Jan 1 → Dec 31 makes the
// January retrospective work properly (the rolling window crosses
// year boundaries and mixes "last December" with the new year's
// "this January"). Date comparison uses ISO YYYY-MM-DD strings.
function yearInReview(year, limit) {
  if (!year) return [];
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;
  const rows = db.prepare(`
    SELECT b.id, b.title, b.cover_path, b.format,
           SUM(rl.pages_read) AS pages, SUM(rl.minutes_read) AS minutes,
           SUM(${ACTIVITY}) AS activity
      FROM reading_log rl
      JOIN books b ON b.id = rl.book_id
     WHERE rl.date >= ? AND rl.date <= ?
     GROUP BY b.id
     HAVING activity > 0
     ORDER BY activity DESC, b.title ASC
     LIMIT ?
  `).all(start, end, limit);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: r.format === 'audiobook'
      ? `${r.minutes.toLocaleString()} min`
      : `${r.pages.toLocaleString()} pages`,
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// Compact star glyph for a numeric rating. 4.5 → "★★★★½", 5 → "★★★★★".
// Returns empty string for null/0 so the sublabel can be omitted cleanly.
function ratingGlyph(r) {
  if (r == null || r <= 0) return '';
  return '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');
}

// "Books I've loved." Binary flag, no ranking dimension — order by
// id DESC so the most-recently-loved show first. Skips books without
// a cover from the perceptual sort? No — we keep them and let the
// skeleton tile carry the name; same as every other mode.
function topLoved(limit) {
  const rows = db.prepare(`
    SELECT id, title, cover_path
      FROM books
     WHERE loved = 1
     ORDER BY id DESC
     LIMIT ?
  `).all(limit);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: null,
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// "My highest-rated books." Threshold of 4★ surfaces a meaningful
// "best of" without the half-star noise around 3.5–3.5 tied books
// crowding lower-rated entries up. Sublabel renders the rating as
// a compact star glyph.
function topRated(limit) {
  const rows = db.prepare(`
    SELECT id, title, cover_path, rating
      FROM books
     WHERE rating IS NOT NULL AND rating >= 4
     ORDER BY rating DESC, title ASC
     LIMIT ?
  `).all(limit);
  return rows.map(r => ({
    id:       r.id,
    label:    r.title,
    sublabel: ratingGlyph(r.rating),
    image:    toCoverUrl(r.cover_path),
    href:     `/books/${r.id}`,
  }));
}

// Facets for client-side picker population. Only surface series that
// have at least one book and years that have at least one reading-log
// entry — empty pickers in the UI would just frustrate the user.
export function getCollageFacets() {
  const series = db.prepare(`
    SELECT DISTINCT series
      FROM books
     WHERE series IS NOT NULL AND series != ''
     ORDER BY series COLLATE NOCASE ASC
  `).all().map(r => r.series);
  const years = db.prepare(`
    SELECT DISTINCT substr(date, 1, 4) AS year
      FROM reading_log
     ORDER BY year DESC
  `).all().map(r => r.year);
  return { series, years };
}

export function computeCollage({ mode, period, size, series, year }) {
  const start = periodStart(period);
  const limit = size * size;
  let tiles;
  switch (mode) {
    case 'top_books':         tiles = topBooks(start, limit);         break;
    case 'top_authors':       tiles = topAuthors(start, limit);       break;
    case 'recently_finished': tiles = recentlyFinished(start, limit); break;
    case 'series_spotlight':  tiles = seriesSpotlight(series, limit); break;
    case 'year_in_review':    tiles = yearInReview(year, limit);      break;
    case 'top_loved':         tiles = topLoved(limit);                break;
    case 'top_rated':         tiles = topRated(limit);                break;
    default: throw new Error(`Unknown collage mode: ${mode}`);
  }
  return {
    mode, period, size,
    series: series ?? null,
    year:   year   ?? null,
    tiles,
  };
}
