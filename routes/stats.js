import express from 'express';
import db from '../db.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*)                          AS books,
      SUM(owned = 1)                    AS owned,
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

  res.json({ totals, formats, fiction, ratings, pagesRead, minutesListened, byYear, topAuthors });
});

export default router;
