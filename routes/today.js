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
  const peek = req.query.peek === 'true' || req.query.peek === '1';
  const picked = pickTodayCard(today, { peek });
  if (!picked) return res.json({ card: null });

  // Queue-driven card types (Connection / Reading Path) hydrate from
  // today_card_queue rather than the books table — no book row, the
  // body is the markdown queue payload. Both types share the same
  // wire shape; only the renderer differs on the client.
  if (picked.type === 'connection' || picked.type === 'reading_path') {
    const row = db.prepare(
      'SELECT id, card_type, title, body, feedback FROM today_card_queue WHERE id = ?'
    ).get(picked.queueId);
    if (!row) return res.json({ card: null });
    return res.json({
      card: {
        type:     row.card_type,
        date:     today,
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
  const meta = computeCardMeta(picked.type, picked.bookId, today);

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

// Past served AI-shaped cards in reverse-chronological order, scoped
// by card_type. Drives the two "Past connections" / "Past reading
// paths" surfaces below today's card on /today — the queue work goes
// into actually-curated chat-generated content, so the cards
// shouldn't vanish after a single day on screen. Feedback fields
// come along so the badge / re-grade UI on each row renders the
// current grade and lets the user upgrade or revise it.
function pastByType(cardType) {
  // Order by served_at (the precise serve timestamp) rather than served_date
  // (the calendar-day mirror). The two are equivalent when data is healthy,
  // but anchoring on served_at means the archive stays correctly
  // reverse-chronological even if served_date ever drifts again. Bad served_
  // date rows on 2026-06-26 cleaned up; the FutureSliver carousel fix
  // prevents fresh drift.
  return db.prepare(`
    SELECT id AS queue_id, title, body, served_date, feedback, feedback_at
      FROM today_card_queue
     WHERE card_type = ? AND served_at IS NOT NULL
     ORDER BY served_at DESC, id DESC
  `).all(cardType);
}

router.get('/connections',   (_req, res) => res.json({ connections:   pastByType('connection')   }));
router.get('/reading-paths', (_req, res) => res.json({ readingPaths:  pastByType('reading_path') }));

// Unserved queue depth per card_type. Drives the low-queue banner on
// /today (1.233+) — when either count drops below the client's
// threshold the page surfaces a quiet warning so we know to draft
// replacement cards before the queue runs out. Cheap query; the
// page polls it once per /today mount.
router.get('/queue-depth', (_req, res) => {
  const rows = db.prepare(`
    SELECT card_type, COUNT(*) AS count
      FROM today_card_queue
     WHERE served_at IS NULL
     GROUP BY card_type
  `).all();
  const depth = { connection: 0, reading_path: 0 };
  for (const r of rows) depth[r.card_type] = r.count;
  res.json({ depth });
});

// "Don't surface this book on Today for N days." Records to
// today_snoozes (migration 075); pickTodayCard's exclusion set
// unions snoozed ids with the 14-day repetition guard. INSERT OR
// REPLACE on the book_id PK lets a re-snooze reset the clock from
// the new click rather than appending.
const SNOOZE_MAX_DAYS = 365;
router.post('/snooze', (req, res) => {
  const bookId = parseInt(req.body?.book_id, 10);
  const days   = parseInt(req.body?.days, 10);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'invalid book_id' });
  if (!Number.isFinite(days) || days < 1 || days > SNOOZE_MAX_DAYS) {
    return res.status(400).json({ error: 'days must be 1..365' });
  }
  const book = db.prepare('SELECT id FROM books WHERE id = ?').get(bookId);
  if (!book) return res.status(404).json({ error: 'book not found' });
  db.prepare(`
    INSERT INTO today_snoozes (book_id, snoozed_until, snoozed_at)
    VALUES (?, date('now', 'localtime', ? || ' days'), CURRENT_TIMESTAMP)
    ON CONFLICT(book_id) DO UPDATE SET
      snoozed_until = excluded.snoozed_until,
      snoozed_at    = excluded.snoozed_at
  `).run(bookId, `+${days}`);
  const row = db.prepare(
    'SELECT snoozed_until FROM today_snoozes WHERE book_id = ?'
  ).get(bookId);
  res.json({ ok: true, snoozed_until: row?.snoozed_until || null });
});

export default router;
