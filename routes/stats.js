import express from 'express';
import db from '../db.js';

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function toISOWeek(dateStr) {
  const d = new Date(dateStr);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function toYearMonth(dateStr) {
  return dateStr.slice(0, 7);
}

function nextDay(d)   { return addDays(d, 1); }
function nextWeek(w)  {
  const [y, wn] = w.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const weeksInYear = toISOWeek(`${y}-12-28`) === `${y}-W53` ? 53 : 52;
  return wn < weeksInYear ? `${y}-W${String(wn + 1).padStart(2, '0')}` : `${y + 1}-W01`;
}
function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo < 12 ? `${y}-${String(mo + 1).padStart(2, '0')}` : `${y + 1}-01`;
}

function longestAndCurrent(periods, nextFn, currentPeriod, prevPeriod) {
  if (!periods.length) return { current: 0, longest: 0 };
  let longest = 1, run = 1;
  for (let i = 1; i < periods.length; i++) {
    run = periods[i] === nextFn(periods[i - 1]) ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const last = periods[periods.length - 1];
  const current = (last === currentPeriod || last === prevPeriod) ? run : 0;
  return { current, longest };
}

function calcStreaks(dates) {
  if (!dates.length) return {
    days:   { current: 0, longest: 0 },
    weeks:  { current: 0, longest: 0 },
    months: { current: 0, longest: 0 },
  };

  const today = new Date().toISOString().slice(0, 10);

  const weeks  = [...new Set(dates.map(toISOWeek))].sort();
  const months = [...new Set(dates.map(toYearMonth))].sort();

  return {
    days:   longestAndCurrent(dates,  nextDay,   today,                    addDays(today, -1)),
    weeks:  longestAndCurrent(weeks,  nextWeek,  toISOWeek(today),         toISOWeek(addDays(today, -7))),
    months: longestAndCurrent(months, nextMonth, toYearMonth(today),       toYearMonth(addDays(today, -32))),
  };
}

const router = express.Router();

router.get('/', (_req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*)                          AS books,
      SUM(owned = 1)                    AS owned,
      SUM(previously_owned = 1)         AS previously_owned,
      SUM(status = 'reading')           AS reading,
      SUM(status = 'paused')            AS paused,
      SUM(status = 'finished')          AS finished,
      SUM(status = 'unread')            AS unread
    FROM books
  `).get();

  const formats = db.prepare(`
    SELECT format, COUNT(*) AS count FROM books GROUP BY format ORDER BY count DESC
  `).all();

  const fiction = db.prepare(`
    SELECT
      SUM(fiction = 1)    AS fiction,
      SUM(fiction = 0)    AS nonfiction,
      SUM(fiction IS NULL) AS unset
    FROM books
  `).get();

  const ratings = db.prepare(`
    SELECT rating, COUNT(*) AS count FROM books WHERE rating IS NOT NULL GROUP BY rating ORDER BY rating DESC
  `).all();

  const pagesRead = db.prepare(`
    SELECT COALESCE(SUM(pages_read), 0) AS total FROM reading_log
  `).get().total;

  const minutesListened = db.prepare(`
    SELECT COALESCE(SUM(minutes_read), 0) AS total FROM reading_log
  `).get().total;

  const byYear = db.prepare(`
    SELECT strftime('%Y', date_finished) AS year, COUNT(*) AS count
    FROM books
    WHERE date_finished IS NOT NULL
    GROUP BY year
    ORDER BY year DESC
  `).all();

  const topAuthors = db.prepare(`
    SELECT author, COUNT(*) AS count FROM books
    WHERE author IS NOT NULL
    GROUP BY author
    ORDER BY count DESC
    LIMIT 10
  `).all();

  const languages = db.prepare(`
    SELECT language, COUNT(*) AS count FROM books
    WHERE language IS NOT NULL
    GROUP BY language ORDER BY count DESC
  `).all();

  const readingDates = db.prepare('SELECT DISTINCT date FROM reading_log ORDER BY date ASC').all().map(r => r.date);
  const streaks = calcStreaks(readingDates);

  const todayPages = db.prepare(`
    SELECT COALESCE(SUM(pages_read), 0) AS total FROM reading_log WHERE date = date('now')
  `).get().total;

  const thisYearBooks = db.prepare(`
    SELECT COUNT(*) AS total FROM books
    WHERE date_finished IS NOT NULL AND strftime('%Y', date_finished) = strftime('%Y', 'now')
  `).get().total;

  res.json({ totals, formats, fiction, ratings, pagesRead, minutesListened, byYear, topAuthors, languages, streaks, todayPages, thisYearBooks });
});

export default router;
