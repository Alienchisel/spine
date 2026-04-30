import db from '../../db.js';
import { calcStreaks } from './streaks.js';

// Reading-activity stats: anything derived from reading_log rows or
// completion-date queries on the books table.
export function getActivityStats() {
  const pagesRead = db.prepare(
    'SELECT COALESCE(SUM(pages_read), 0) AS total FROM reading_log'
  ).get().total;

  const minutesListened = db.prepare(
    'SELECT COALESCE(SUM(minutes_read), 0) AS total FROM reading_log'
  ).get().total;

  const byYear = db.prepare(`
    SELECT strftime('%Y', date_finished) AS year, COUNT(*) AS count
    FROM books
    WHERE date_finished IS NOT NULL
    GROUP BY year
    ORDER BY year DESC
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
    'SELECT COUNT(DISTINCT date) AS days, COALESCE(SUM(pages_read), 0) AS pages FROM reading_log'
  ).get();
  const avgPagesPerDay = readingDays.days > 0 ? Math.round(readingDays.pages / readingDays.days) : null;

  return {
    pagesRead,
    minutesListened,
    byYear,
    streaks,
    todayPages,
    thisYearBooks,
    thisYearPages,
    avgPagesPerDay,
  };
}
