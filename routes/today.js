import express from 'express';
import db from '../db.js';
import { getBook } from '../lib/books/repository.js';
import { pickTodayCard, computeCardMeta } from '../lib/today/card.js';

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

  // Connection cards hydrate from today_card_queue rather than the
  // books table — no book row, the body is the markdown queue payload.
  if (picked.type === 'connection') {
    const row = db.prepare(
      'SELECT id, title, body, feedback FROM today_card_queue WHERE id = ?'
    ).get(picked.queueId);
    if (!row) return res.json({ card: null });
    return res.json({
      card: {
        type: 'connection',
        date: today,
        queue_id: row.id,
        title:    row.title,
        body:     row.body,
        feedback: row.feedback || null,
      },
    });
  }

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

  // Per-type meta (author aggregations, loved-title sibling lookup,
  // etc.). Recomputed each request from live data so a status change
  // mid-day reflects in the rendered text without leaving the
  // persisted (date, type, book_id) tuple stale.
  const meta = computeCardMeta(picked.type, picked.bookId);

  res.json({
    card: {
      type: picked.type,
      book,
      date: today,
      days_since_finished: diffs?.days_since_finished ?? null,
      days_since_started:  diffs?.days_since_started  ?? null,
      days_since_acquired: diffs?.days_since_acquired ?? null,
      meta,
    },
  });
});

// Post-hoc feedback on Connection cards. Records the user's read
// (Signal / Knew / Reaching) on the served queue row. The next batch
// generation reads these as few-shot examples — "this user found
// these specific connections insightful, generate more like them" —
// without any in-app fine-tuning loop. Only applies to Connection
// cards in v1; the deterministic types don't benefit from feedback.
const ALLOWED_FEEDBACK = new Set(['signal', 'knew', 'reaching']);
router.post('/queue/:id/feedback', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const value = req.body?.value;
  if (value !== null && !ALLOWED_FEEDBACK.has(value)) {
    return res.status(400).json({ error: 'invalid value' });
  }
  // null clears a prior grade — useful if the user mis-clicks. Stored
  // values are 'signal' / 'knew' / 'reaching' to match the manual
  // batch-generation taxonomy.
  const result = db.prepare(`
    UPDATE today_card_queue
       SET feedback    = ?,
           feedback_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END
     WHERE id = ?
  `).run(value, value, id);
  if (!result.changes) return res.status(404).json({ error: 'queue row not found' });
  res.json({ ok: true, feedback: value });
});

export default router;
