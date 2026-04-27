import express from 'express';
import db from '../db.js';

const router = express.Router();

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

function computeDayStreak(sortedDates) {
  if (!sortedDates.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const last = sortedDates[sortedDates.length - 1];
  if (last !== today && last !== yesterday) return 0;
  let n = 1;
  for (let i = sortedDates.length - 1; i > 0; i--) {
    if ((new Date(sortedDates[i]) - new Date(sortedDates[i - 1])) / 86400000 === 1) n++;
    else break;
  }
  return n;
}

function computeWeekStreak(sortedDates) {
  if (!sortedDates.length) return 0;
  const weeks = [...new Set(sortedDates.map(mondayOf))].sort();
  const today = new Date().toISOString().slice(0, 10);
  const thisWeek = mondayOf(today);
  const lastWeek = mondayOf(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  if (weeks[weeks.length - 1] !== thisWeek && weeks[weeks.length - 1] !== lastWeek) return 0;
  let n = 1;
  for (let i = weeks.length - 1; i > 0; i--) {
    if ((new Date(weeks[i]) - new Date(weeks[i - 1])) / 86400000 === 7) n++;
    else break;
  }
  return n;
}

router.get('/', (req, res) => {
  const yearParam = parseInt(req.query.year);
  const year = (yearParam >= 1900 && yearParam <= 2200) ? yearParam : null;

  const allDates = db.prepare('SELECT DISTINCT date FROM reading_log ORDER BY date ASC').all().map(r => r.date);
  const years = db.prepare("SELECT DISTINCT CAST(strftime('%Y', date) AS INTEGER) as y FROM reading_log ORDER BY y DESC").all().map(r => r.y);

  const rows = year
    ? db.prepare(`
        SELECT rl.id, rl.book_id, rl.date, rl.pages_read, rl.minutes_read,
               b.title, b.cover_path, b.format
        FROM reading_log rl JOIN books b ON b.id = rl.book_id
        WHERE rl.date LIKE ?
        ORDER BY rl.date DESC, b.title ASC
      `).all(`${year}-%`)
    : db.prepare(`
        SELECT rl.id, rl.book_id, rl.date, rl.pages_read, rl.minutes_read,
               b.title, b.cover_path, b.format
        FROM reading_log rl JOIN books b ON b.id = rl.book_id
        ORDER BY rl.date DESC, b.title ASC
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
      cover_path: row.cover_path ? `/uploads/${row.cover_path}` : null,
      format: row.format, pages_read: row.pages_read, minutes_read: row.minutes_read,
    });
  }

  res.json({
    days:  Object.entries(byDate).map(([date, entries]) => ({ date, entries })),
    years,
    stats: { dayStreak: computeDayStreak(allDates), weekStreak: computeWeekStreak(allDates) },
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
