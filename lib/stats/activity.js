import db from '../../db.js';
import { calcStreaks } from './streaks.js';
import { toCoverUrl } from '../books/normalization.js';
import { titleSortExpr } from '../books/filters.js';

// Cumulative monthly totals of acquired vs finished books since the
// first known event. Used by /data-viz to plot the "to-read mountain":
// the running gap between acquisition rate and finish rate over time.
// Both series are zero-filled across months with no activity so the
// cumulative line continues flat rather than skipping. Note: finished
// here means date_finished IS NOT NULL — only formally dated finishes
// are counted; books read but never date-stamped are excluded by
// design (see audit gap "Owned books have finish date").
export function getLibraryTrajectory() {
  // substr extraction (not strftime) because acquisition_date is allowed
  // to be partial — bare "YYYY" or "YYYY-MM" — and SQLite's strftime
  // mangles those formats (returns garbage years for the year-only case,
  // empty string for YYYY-MM). Year-only dates collapse into January of
  // that year, which is the best assumption available; month-only
  // dates pass through as-is.
  const monthExpr = `
    CASE
      WHEN length(d) >= 7 THEN substr(d, 1, 7)
      WHEN length(d) = 4  THEN d || '-01'
      ELSE NULL
    END`;
  const acq = db.prepare(`
    SELECT month, COUNT(*) AS n FROM (
      SELECT ${monthExpr.replace(/\bd\b/g, 'acquisition_date')} AS month
      FROM books
      WHERE acquisition_date IS NOT NULL AND acquisition_date != ''
    )
    WHERE month IS NOT NULL
    GROUP BY month
  `).all();
  // Library trajectory counts each book once at its *first* finish —
  // the moment it entered the "finished" pile. A re-read in 2025 of a
  // book first finished in 2020 must not add a second tick to the
  // 2025 month (that would distort the cumulative unique-books-finished
  // trajectory). first_finished = MIN(reads.date_finished) per book.
  const fin = db.prepare(`
    SELECT month, COUNT(*) AS n FROM (
      SELECT ${monthExpr.replace(/\bd\b/g, 'first_finished')} AS month FROM (
        SELECT MIN(date_finished) AS first_finished
        FROM reads
        WHERE date_finished IS NOT NULL AND date_finished != ''
        GROUP BY book_id
      )
    )
    WHERE month IS NOT NULL
    GROUP BY month
  `).all();

  const acqMap = new Map(acq.map(r => [r.month, r.n]));
  const finMap = new Map(fin.map(r => [r.month, r.n]));
  const allKeys = [...acqMap.keys(), ...finMap.keys()];
  if (!allKeys.length) return [];

  const minMonth = allKeys.reduce((a, b) => (a < b ? a : b));
  const maxMonth = allKeys.reduce((a, b) => (a > b ? a : b));
  let [y, m] = minMonth.split('-').map(Number);
  const [yEnd, mEnd] = maxMonth.split('-').map(Number);

  const out = [];
  let acqCum = 0, finCum = 0;
  while (y < yEnd || (y === yEnd && m <= mEnd)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    acqCum += acqMap.get(key) || 0;
    finCum += finMap.get(key) || 0;
    out.push({ month: key, acquired: acqCum, finished: finCum });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Per-day reading totals across the entire log, summed over book_id and
// story_id so a day with two finished sessions shows the combined effort.
// Used by /data-viz's calendar grid; kept out of the main /api/stats
// payload because the row count grows linearly with the log and most
// pages don't need it.
export function getReadingCalendar() {
  return db.prepare(`
    SELECT date,
           SUM(pages_read)   AS pages,
           SUM(minutes_read) AS minutes
    FROM reading_log
    GROUP BY date
    ORDER BY date ASC
  `).all();
}

// Reading-activity stats: anything derived from reading_log rows or
// completion-date queries on the books table.
export function getActivityStats() {
  // Lifetime "pages read" = page_count of every finished book, multiplied
  // by read_count so re-reads contribute (a 300-page book read 3× counts
  // as 900). Audiobooks contribute too — page_count on audiobooks holds
  // the print-equivalent size that the user maintains, so a finished
  // 400-page audiobook adds 400 pages to the lifetime total just like
  // any other format. Audiobooks without page_count silently drop out
  // (page_count > 0 guard).
  // todayPages / byMonth / streaks still use reading_log for the daily
  // tracking flavour.
  // 'date_finished IS NOT NULL' was the pre-Phase-3 proxy for "has been
  // read." With reads as canonical, the equivalent is "has at least
  // one finished reads row" — and for finished books that's the cohort
  // we care about (status='finished' implies a reads row exists, but
  // a finished book without any dated reads still 'has been read' the
  // page_count's worth at least once).
  const pagesRead = db.prepare(`
    SELECT COALESCE(SUM(page_count * MAX(read_count, 1)), 0) AS total
    FROM books
    WHERE status = 'finished'
      AND page_count > 0
  `).get().total;

  const minutesListened = db.prepare(
    'SELECT COALESCE(SUM(minutes_read), 0) AS total FROM reading_log'
  ).get().total;

  // substr (not strftime) on the year prefix: date_finished is a
  // partial-date TEXT field — YYYY / YYYY-MM / YYYY-MM-DD — and
  // strftime('%Y', 'YYYY') returns junk like '-4707' because SQLite
  // tries to parse a 4-char-only string as a Julian date. substr(...,1,4)
  // pulls the year regardless of precision.
  // Year buckets are computed off the *first finish* of each book so
  // re-reads don't double-count toward the unique-books-per-year tally.
  // Pages contribution uses the book's page_count once per book per
  // first-finish year — re-reads don't bump the year total either.
  const byYear = db.prepare(`
    SELECT
      substr(first_finished, 1, 4) AS year,
      COUNT(*)                    AS count,
      COALESCE(SUM(page_count), 0) AS pages
    FROM (
      SELECT b.page_count, MIN(r.date_finished) AS first_finished
      FROM books b
      JOIN reads r ON r.book_id = b.id
      WHERE r.date_finished IS NOT NULL AND r.date_finished != ''
      GROUP BY b.id
    )
    GROUP BY year
    ORDER BY year DESC
  `).all();

  // Acquisitions by year — books with a known acquisition_date, grouped
  // by the year prefix. Same substr trick for partial-date safety.
  const acquiredByYear = db.prepare(`
    SELECT
      substr(acquisition_date, 1, 4) AS year,
      COUNT(*)                       AS count
    FROM books
    WHERE acquisition_date IS NOT NULL AND acquisition_date != ''
    GROUP BY year
    ORDER BY year DESC
  `).all();

  // Acquisitions broken out by source × year for small-multiples
  // visualization on /data-viz. Sources are kept as-is (no canonicalisation
  // beyond what the user has manually applied via the acquisition_source
  // PATCH); empty / null sources collapse into the "Unknown" bucket so the
  // total adds up. The result is a flat row stream; the client pivots into
  // per-source year arrays so it can apply its own truncation (top-N +
  // "Other") without a server round-trip.
  const acquiredByYearAndSource = db.prepare(`
    SELECT
      substr(acquisition_date, 1, 4)                         AS year,
      COALESCE(NULLIF(acquisition_source, ''), 'Unknown')    AS source,
      COUNT(*)                                               AS count
    FROM books
    WHERE acquisition_date IS NOT NULL AND acquisition_date != ''
    GROUP BY year, source
    ORDER BY year ASC, source ASC
  `).all();

  // Distinct reading days per calendar month, last 12 months. Captures
  // consistency (vs byYear which captures volume).
  const byMonth = db.prepare(`
    SELECT substr(date, 1, 7) AS month, COUNT(DISTINCT date) AS days
    FROM reading_log
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all();

  const readingDates = db.prepare(
    'SELECT DISTINCT date FROM reading_log ORDER BY date ASC'
  ).all().map(r => r.date);
  const streaks = calcStreaks(readingDates);

  const todayPages = db.prepare(
    "SELECT COALESCE(SUM(pages_read), 0) AS total FROM reading_log WHERE date = date('now', 'localtime')"
  ).get().total;

  // strftime('%Y', x) returns NULL for partial dates like '2019' / '2019-07',
  // so books finished with a vague-memory date silently drop out of the
  // year-count. Defensible: a vague memory shouldn't contribute to "this
  // year's finishes." Same goes for the avg-days-to-finish query below.
  // Count distinct books with at least one read finishing in the
  // current calendar year. DISTINCT keeps re-reads from inflating the
  // "books finished this year" hero stat.
  const thisYearBooks = db.prepare(`
    SELECT COUNT(DISTINCT book_id) AS total FROM reads
    WHERE date_finished IS NOT NULL
      AND strftime('%Y', date_finished) = strftime('%Y', 'now')
  `).get().total;

  const thisYearPages = db.prepare(`
    SELECT COALESCE(SUM(pages_read), 0) AS total FROM reading_log
    WHERE strftime('%Y', date) = strftime('%Y', 'now')
  `).get().total;

  const readingDays = db.prepare(
    'SELECT COUNT(DISTINCT date) AS days, COALESCE(SUM(pages_read), 0) AS pages FROM reading_log WHERE pages_read > 0'
  ).get();
  const avgPagesPerDay = readingDays.days > 0 ? Math.round(readingDays.pages / readingDays.days) : null;

  const listeningDays = db.prepare(
    'SELECT COUNT(DISTINCT date) AS days, COALESCE(SUM(minutes_read), 0) AS minutes FROM reading_log WHERE minutes_read > 0'
  ).get();
  const avgMinutesPerDay = listeningDays.days > 0 ? Math.round(listeningDays.minutes / listeningDays.days) : null;

  // Average elapsed days between date_started and date_finished across
  // *reading sessions*, not books. A book read twice contributes both
  // reading durations; the pre-Phase-2 version pulled only book.date_*
  // (the first-read pair) and ignored re-reads. Skips reads with
  // missing/inverted dates so a single bad entry can't poison the mean.
  const avgDaysRow = db.prepare(`
    SELECT AVG(julianday(date_finished) - julianday(date_started)) AS avg_days
    FROM reads
    WHERE date_started IS NOT NULL AND date_finished IS NOT NULL
      AND julianday(date_finished) >= julianday(date_started)
  `).get();
  const avgDaysToFinish = avgDaysRow.avg_days != null ? Math.round(avgDaysRow.avg_days) : null;

  // Per-book pace projection for everything currently in 'reading'. Page-based
  // formats project off avgPagesPerDay; audiobooks off avgMinutesPerDay. If the
  // relevant rate is missing or progress is already at/past the end, projection
  // is null and the client renders a dash.
  const reading = db.prepare(`
    SELECT id, title, cover_path, format, page_count, current_page, duration_minutes, current_minutes
    FROM books
    WHERE status = 'reading'
    ORDER BY updated_at DESC, ${titleSortExpr()} ASC
  `).all();

  const inProgressPace = reading.map(b => {
    let pct = null;
    let projected_days_left = null;
    if (b.format === 'audiobook' && b.duration_minutes > 0) {
      const cur = b.current_minutes ?? 0;
      pct = Math.min(100, Math.round((cur / b.duration_minutes) * 100));
      const remaining = Math.max(0, b.duration_minutes - cur);
      if (remaining > 0 && avgMinutesPerDay > 0) projected_days_left = Math.ceil(remaining / avgMinutesPerDay);
    } else if (b.page_count > 0) {
      const cur = b.current_page ?? 0;
      pct = Math.min(100, Math.round((cur / b.page_count) * 100));
      const remaining = Math.max(0, b.page_count - cur);
      if (remaining > 0 && avgPagesPerDay > 0) projected_days_left = Math.ceil(remaining / avgPagesPerDay);
    }
    return {
      id: b.id, title: b.title, cover_path: toCoverUrl(b.cover_path), format: b.format,
      pct, projected_days_left,
    };
  });

  return {
    pagesRead,
    minutesListened,
    byYear,
    acquiredByYear,
    acquiredByYearAndSource,
    byMonth,
    streaks,
    todayPages,
    thisYearBooks,
    thisYearPages,
    avgPagesPerDay,
    avgMinutesPerDay,
    avgDaysToFinish,
    inProgressPace,
  };
}
