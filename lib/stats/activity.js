import db from '../../db.js';
import { calcStreaks } from './streaks.js';
import { toCoverUrl } from '../books/normalization.js';

// Reading-activity stats: anything derived from reading_log rows or
// completion-date queries on the books table.
export function getActivityStats() {
  // Lifetime "pages read" = page_count of every finished non-audiobook,
  // multiplied by read_count so re-reads contribute (a 300-page book read
  // 3× counts as 900). Replaces an older definition that summed only
  // reading_log increments — that under-counted historical reads and
  // every book where the user never tracked progress page-by-page.
  // todayPages / byMonth / streaks still use reading_log for the daily
  // tracking flavour.
  const pagesRead = db.prepare(`
    SELECT COALESCE(SUM(page_count * MAX(read_count, 1)), 0) AS total
    FROM books
    WHERE date_finished IS NOT NULL
      AND COALESCE(format, '') != 'audiobook'
      AND page_count > 0
  `).get().total;

  const minutesListened = db.prepare(
    'SELECT COALESCE(SUM(minutes_read), 0) AS total FROM reading_log'
  ).get().total;

  const byYear = db.prepare(`
    SELECT
      strftime('%Y', date_finished) AS year,
      COUNT(*)                      AS count,
      COALESCE(SUM(page_count), 0)  AS pages
    FROM books
    WHERE date_finished IS NOT NULL
    GROUP BY year
    ORDER BY year DESC
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

  const thisYearBooks = db.prepare(`
    SELECT COUNT(*) AS total FROM books
    WHERE date_finished IS NOT NULL AND strftime('%Y', date_finished) = strftime('%Y', 'now')
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

  // Average elapsed days between date_started and date_finished. Skips books
  // with missing/inverted dates so a single bad entry can't poison the mean.
  const avgDaysRow = db.prepare(`
    SELECT AVG(julianday(date_finished) - julianday(date_started)) AS avg_days
    FROM books
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
    ORDER BY updated_at DESC
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

  // Pages-per-reading-day distribution. Groups reading_log rows by date,
  // sums pages_read per day, then buckets the days into fixed ranges so
  // the user can see the *shape* of their daily reading (typical chunk
  // size, frequency of big sessions). Days with pages_read = 0 are
  // excluded — those are time-only entries (audiobook backfills) that
  // would skew a page-based distribution. Bucket edges are inclusive
  // lower / inclusive upper; the top bucket is open-ended.
  const PAGE_BUCKETS = [
    { label: '1-10',    min: 1,   max: 10   },
    { label: '11-25',   min: 11,  max: 25   },
    { label: '26-50',   min: 26,  max: 50   },
    { label: '51-100',  min: 51,  max: 100  },
    { label: '101-200', min: 101, max: 200  },
    { label: '201+',    min: 201, max: null },
  ];
  const dailyTotals = db.prepare(`
    SELECT date, SUM(pages_read) AS pages
    FROM reading_log
    GROUP BY date
    HAVING SUM(pages_read) > 0
  `).all();
  const pagesPerDayDistribution = PAGE_BUCKETS.map(b => ({
    label: b.label,
    min:   b.min,
    max:   b.max,
    days:  dailyTotals.filter(d => d.pages >= b.min && (b.max == null || d.pages <= b.max)).length,
  }));

  return {
    pagesRead,
    minutesListened,
    byYear,
    byMonth,
    streaks,
    todayPages,
    thisYearBooks,
    thisYearPages,
    avgPagesPerDay,
    avgMinutesPerDay,
    avgDaysToFinish,
    inProgressPace,
    pagesPerDayDistribution,
  };
}
