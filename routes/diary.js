import express from 'express';
import db from '../db.js';
import { toCoverUrl } from '../lib/books/normalization.js';
import { calcStreaks } from '../lib/stats/streaks.js';

const router = express.Router();

router.get('/', (req, res) => {
  const yearParam = parseInt(req.query.year);
  const year = (yearParam >= 1900 && yearParam <= 2200) ? yearParam : null;

  const allDates = db.prepare('SELECT DISTINCT date FROM reading_log ORDER BY date ASC').all().map(r => r.date);
  const years = db.prepare("SELECT DISTINCT CAST(strftime('%Y', date) AS INTEGER) as y FROM reading_log ORDER BY y DESC").all().map(r => r.y);

  // story_id may be NULL (book-level read) or set (story-level read).
  // Layer 3: a non-NULL story_id surfaces the story's title and position
  // in the diary entry as "Read 'Story' — Book Title".
  const rows = year
    ? db.prepare(`
        SELECT rl.id, rl.book_id, rl.story_id, rl.date, rl.pages_read, rl.minutes_read,
               b.title, b.cover_path, b.format,
               s.title AS story_title, s.position AS story_position
        FROM reading_log rl
        JOIN books b ON b.id = rl.book_id
        LEFT JOIN stories s ON s.id = rl.story_id
        WHERE rl.date LIKE ?
        ORDER BY rl.date DESC, rl.id DESC
      `).all(`${year}-%`)
    : db.prepare(`
        SELECT rl.id, rl.book_id, rl.story_id, rl.date, rl.pages_read, rl.minutes_read,
               b.title, b.cover_path, b.format,
               s.title AS story_title, s.position AS story_position
        FROM reading_log rl
        JOIN books b ON b.id = rl.book_id
        LEFT JOIN stories s ON s.id = rl.story_id
        ORDER BY rl.date DESC, rl.id DESC
      `).all();

  const bookIds = [...new Set(rows.map(r => r.book_id))];
  const authorMap = new Map();
  if (bookIds.length) {
    db.prepare(`
      SELECT ba.book_id, a.name FROM authors a
      JOIN book_authors ba ON ba.author_id = a.id
      WHERE ba.book_id IN (${bookIds.map(() => '?').join(',')})
      ORDER BY ba.position
    `).all(...bookIds).forEach(({ book_id, name }) => {
      if (!authorMap.has(book_id)) authorMap.set(book_id, []);
      authorMap.get(book_id).push(name);
    });
  }

  const byDate = {};
  for (const row of rows) {
    if (!byDate[row.date]) byDate[row.date] = [];
    byDate[row.date].push({
      id: row.id, book_id: row.book_id, title: row.title,
      authors: authorMap.get(row.book_id) || [],
      cover_path: toCoverUrl(row.cover_path),
      format: row.format, pages_read: row.pages_read, minutes_read: row.minutes_read,
      story_id: row.story_id, story_title: row.story_title, story_position: row.story_position,
    });
  }

  // Diary surfaces day/week streaks (current + longest) in its sidebar.
  // The shared calcStreaks() also computes month streaks; we discard those.
  const streaks = calcStreaks(allDates);

  // Now-relative totals — computed against today's real date across the full
  // reading_log, NOT filtered by the selected year. Mirrors how streaks work:
  // the dropdown only affects the displayed entries, not the always-now stats.
  // SQLite's strftime '%w' returns 0=Sunday..6=Saturday; we anchor weeks Mon–Sun.
  const totalsRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN date >= date('now','localtime','weekday 0','-6 days') AND date <= date('now','localtime','weekday 0') THEN pages_read   END), 0) AS week_pages,
      COALESCE(SUM(CASE WHEN date >= date('now','localtime','weekday 0','-6 days') AND date <= date('now','localtime','weekday 0') THEN minutes_read END), 0) AS week_minutes,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime') THEN pages_read   END), 0) AS month_pages,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime') THEN minutes_read END), 0) AS month_minutes,
      COALESCE(SUM(CASE WHEN strftime('%Y',    date) = strftime('%Y',    'now', 'localtime') THEN pages_read   END), 0) AS year_pages,
      COALESCE(SUM(CASE WHEN strftime('%Y',    date) = strftime('%Y',    'now', 'localtime') THEN minutes_read END), 0) AS year_minutes
    FROM reading_log
  `).get();

  res.json({
    days:  Object.entries(byDate).map(([date, entries]) => ({ date, entries })),
    years,
    stats: {
      dayStreak:           streaks.days.current,
      dayStreakBest:       streaks.days.longest,
      dayStreakSince:      streaks.days.currentStart,
      dayStreakBestStart:  streaks.days.longestStart,
      dayStreakBestEnd:    streaks.days.longestEnd,
      weekStreak:          streaks.weeks.current,
      weekStreakBest:      streaks.weeks.longest,
      thisWeek:            { pages: totalsRow.week_pages,  minutes: totalsRow.week_minutes  },
      thisMonth:           { pages: totalsRow.month_pages, minutes: totalsRow.month_minutes },
      thisYear:            { pages: totalsRow.year_pages,  minutes: totalsRow.year_minutes  },
    },
  });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
  const entry = db.prepare('SELECT id FROM reading_log WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM reading_log WHERE id = ?').run(id);
  res.status(204).end();
});

export default router;
