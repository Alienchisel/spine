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
  //
  // `finished` flags an entry whose date matches a non-DNF finish event:
  // book-level rows consult reads.date_finished, story-level rows consult
  // the joined stories.date_finished. The diary then chips the row so a
  // session that closed out the book is distinguishable from one that
  // just made progress.
  const finishedExpr = `
    CASE
      WHEN rl.story_id IS NULL AND EXISTS (
        SELECT 1 FROM reads r
        WHERE r.book_id = rl.book_id
          AND r.date_finished = rl.date
          AND COALESCE(r.did_not_finish, 0) = 0
      ) THEN 1
      WHEN rl.story_id IS NOT NULL
        AND s.date_finished = rl.date
        AND COALESCE(s.did_not_finish, 0) = 0 THEN 1
      ELSE 0
    END
  `;
  const rows = year
    ? db.prepare(`
        SELECT rl.id, rl.book_id, rl.story_id, rl.date, rl.pages_read, rl.minutes_read,
               b.title, b.cover_path, b.format,
               s.title AS story_title, s.position AS story_position,
               (${finishedExpr}) AS finished
        FROM reading_log rl
        JOIN books b ON b.id = rl.book_id
        LEFT JOIN stories s ON s.id = rl.story_id
        WHERE rl.date LIKE ?
        ORDER BY rl.date DESC, rl.id DESC
      `).all(`${year}-%`)
    : db.prepare(`
        SELECT rl.id, rl.book_id, rl.story_id, rl.date, rl.pages_read, rl.minutes_read,
               b.title, b.cover_path, b.format,
               s.title AS story_title, s.position AS story_position,
               (${finishedExpr}) AS finished
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

  // A book may have BOTH a book-level row (story_id IS NULL) and one
  // or more story-level rows (story_id IS NOT NULL) on the same date —
  // the schema permits it, and users hit this naturally when they log
  // story-by-story while ALSO running a book-level PATCH (current_page
  // bump) on the same session. The two layers describe the same pages
  // at different granularities; summing them would double-count.
  //
  // Mark each book-level row with `redundant: true` when story-level
  // rows exist for the same (book_id, date). The client dims those
  // rows so the duplication is visible, and the daily total below
  // takes MAX(book-level, sum-of-stories) per book so the count is
  // honest. We keep redundant rows in the response (rather than
  // hiding them) so the user can still see and delete them.
  const storyTuples = new Set();
  for (const row of rows) {
    if (row.story_id != null) storyTuples.add(`${row.book_id}|${row.date}`);
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
      finished: Boolean(row.finished),
      redundant: row.story_id == null && storyTuples.has(`${row.book_id}|${row.date}`),
    });
  }

  // Per (book_id, date) dedup: MAX(book-level total, sum of story-level
  // totals) is the effective count for that book on that day. Sum the
  // effective counts across books for the day's pages_total /
  // minutes_total. Identical aggregation lives in the SQL stats query
  // below — keep them in sync if either changes.
  function effectiveDayTotal(entries, field) {
    const byBook = new Map();
    for (const e of entries) {
      const v = e[field] || 0;
      if (!byBook.has(e.book_id)) byBook.set(e.book_id, { book: 0, story: 0 });
      const bucket = byBook.get(e.book_id);
      if (e.story_id != null) bucket.story += v;
      else                    bucket.book  += v;
    }
    let total = 0;
    for (const { book, story } of byBook.values()) total += Math.max(book, story);
    return total;
  }

  // Diary surfaces day/week streaks (current + longest) in its sidebar.
  // The shared calcStreaks() also computes month streaks; we discard those.
  const streaks = calcStreaks(allDates);

  // Now-relative totals — computed against today's real date across the full
  // reading_log, NOT filtered by the selected year. Mirrors how streaks work:
  // the dropdown only affects the displayed entries, not the always-now stats.
  // SQLite's strftime '%w' returns 0=Sunday..6=Saturday; we anchor weeks Mon–Sun.
  //
  // Same (book_id, date) dedup as the per-day totals above: per book/day,
  // effective pages = MAX(book-level sum, story-level sum). Without the
  // dedup a user who logs both layers double-counts at the week/month/
  // year scope just like at the day scope.
  const totalsRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN date >= date('now','localtime','weekday 0','-6 days') AND date <= date('now','localtime','weekday 0') THEN effective_pages   END), 0) AS week_pages,
      COALESCE(SUM(CASE WHEN date >= date('now','localtime','weekday 0','-6 days') AND date <= date('now','localtime','weekday 0') THEN effective_minutes END), 0) AS week_minutes,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime') THEN effective_pages   END), 0) AS month_pages,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now', 'localtime') THEN effective_minutes END), 0) AS month_minutes,
      COALESCE(SUM(CASE WHEN strftime('%Y',    date) = strftime('%Y',    'now', 'localtime') THEN effective_pages   END), 0) AS year_pages,
      COALESCE(SUM(CASE WHEN strftime('%Y',    date) = strftime('%Y',    'now', 'localtime') THEN effective_minutes END), 0) AS year_minutes
    FROM (
      SELECT
        book_id,
        date,
        max(
          SUM(CASE WHEN story_id IS NULL     THEN pages_read   ELSE 0 END),
          SUM(CASE WHEN story_id IS NOT NULL THEN pages_read   ELSE 0 END)
        ) AS effective_pages,
        max(
          SUM(CASE WHEN story_id IS NULL     THEN minutes_read ELSE 0 END),
          SUM(CASE WHEN story_id IS NOT NULL THEN minutes_read ELSE 0 END)
        ) AS effective_minutes
      FROM reading_log
      GROUP BY book_id, date
    )
  `).get();

  res.json({
    // pages_total / minutes_total are pre-summed here so the client has
    // a single source of truth for daily aggregates — previously each
    // of four call sites in Diary.jsx ran its own .reduce() over
    // entries, easy to drift when the aggregation rule changes.
    days: Object.entries(byDate).map(([date, entries]) => ({
      date,
      entries,
      pages_total:   effectiveDayTotal(entries, 'pages_read'),
      minutes_total: effectiveDayTotal(entries, 'minutes_read'),
    })),
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
