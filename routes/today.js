import express from 'express';
import db from '../db.js';
import { getBook } from '../lib/books/repository.js';
import { pickTodayCard } from '../lib/today/card.js';

const router = express.Router();

// Returns today's card or null when no cohort is eligible.
// Calendar-day diffs (days_since_finished / started / acquired) come
// from SQL julianday rather than JS ms arithmetic — DST-safe per the
// project's calendar-day rule.
router.get('/card', (req, res) => {
  const today = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
    ? req.query.date
    : new Date().toLocaleDateString('en-CA');  // YYYY-MM-DD in local time
  const picked = pickTodayCard(today);
  if (!picked) return res.json({ card: null });

  const book = getBook(picked.bookId);
  if (!book) return res.json({ card: null });

  // Per-type day diffs the client renders directly. The route stays
  // type-agnostic: we attach all three; whichever the client cares
  // about for its rendering mode wins.
  const diffs = db.prepare(`
    SELECT
      CAST(julianday(?) - julianday(date_finished)    AS INTEGER) AS days_since_finished,
      CAST(julianday(?) - julianday(date_started)     AS INTEGER) AS days_since_started,
      CAST(julianday(?) - julianday(acquisition_date) AS INTEGER) AS days_since_acquired
    FROM books WHERE id = ?
  `).get(today, today, today, picked.bookId);

  res.json({
    card: {
      type: picked.type,
      book,
      date: today,
      days_since_finished: diffs?.days_since_finished ?? null,
      days_since_started:  diffs?.days_since_started  ?? null,
      days_since_acquired: diffs?.days_since_acquired ?? null,
    },
  });
});

export default router;
