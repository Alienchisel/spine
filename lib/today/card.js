import db from '../../db.js';

// Daily "Today" card mix. Six deterministic card types as of 1.219.0,
// all computed by local SQL — no AI yet. The original three from v0
// (loved_resurface / slow_burn / recent_acquisition) plus three new
// 1.219 types that surface different cohorts of forgotten / under-read
// shapes:
//
//   - forgotten_readlist          on_readlist=1, never started, ranked
//                                 by readlist_position DESC so the
//                                 "deep in the queue" books surface
//                                 first.
//   - author_barely_opened        unread books by authors with ≥5
//                                 books in the library and <15%
//                                 finished. 'Robert E. Howard — 37
//                                 books, 4 finished' shape.
//   - loved_author_followup       unread books by authors with at
//                                 least one loved book in the library.
//                                 'You loved X; here's an unread Y by
//                                 the same author.'
//
// Selection rolls daily via a date seed. Picks are persisted to the
// today_card_history table (migration 072) so:
//   - the card is stable per calendar day even if the underlying
//     cohorts shift mid-day,
//   - books surfaced in the last 14 days are excluded from new picks
//     (repetition guard — solves the Rothbard A to Z double-day from
//     the v0 smoke test).
//
// All cohorts exclude archived books. recent_acquisition also excludes
// stubs (wishlist placeholders are not real acquisitions).

const COHORT_SQL = {
  loved_resurface: `
    SELECT id FROM books
    WHERE loved = 1
      AND date_finished IS NOT NULL
      AND date_finished < date('now', 'localtime', '-180 days')
      AND COALESCE(archived, 0) = 0
    ORDER BY id
  `,
  slow_burn: `
    SELECT id FROM books
    WHERE status = 'reading'
      AND date_started IS NOT NULL
      AND date_started < date('now', 'localtime', '-30 days')
      AND COALESCE(archived, 0) = 0
    ORDER BY id
  `,
  recent_acquisition: `
    SELECT id FROM books
    WHERE owned = 1
      AND acquisition_date IS NOT NULL
      AND acquisition_date >= date('now', 'localtime', '-14 days')
      AND status = 'unread'
      AND COALESCE(is_stub, 0) = 0
      AND COALESCE(archived, 0) = 0
    ORDER BY id
  `,
  forgotten_readlist: `
    SELECT id FROM books
    WHERE on_readlist = 1
      AND status = 'unread'
      AND COALESCE(archived, 0) = 0
    ORDER BY readlist_position DESC, id ASC
  `,
  // Unread books by authors with a substantial library presence and a
  // low finish rate. Aggregation via a derived table keyed on the
  // first-author bucket (ba.position = 0) — the same primary-author
  // model the Stats and Library pages use. Thresholds: ≥5 books in
  // the library, <15% finished. Books themselves must be unread,
  // unarchived, and non-stub.
  author_barely_opened: `
    SELECT b.id
    FROM books b
    JOIN book_authors ba ON ba.book_id = b.id AND ba.position = 0
    JOIN (
      SELECT ba2.author_id,
             COUNT(DISTINCT ba2.book_id) AS book_count,
             SUM(CASE WHEN b2.status = 'finished' THEN 1 ELSE 0 END) AS finished_count
      FROM book_authors ba2
      JOIN books b2 ON b2.id = ba2.book_id
      WHERE ba2.position = 0
        AND COALESCE(b2.archived, 0) = 0
        AND COALESCE(b2.is_stub, 0) = 0
      GROUP BY ba2.author_id
      HAVING book_count >= 5
        AND (finished_count * 1.0 / book_count) < 0.15
    ) stats ON stats.author_id = ba.author_id
    WHERE b.status = 'unread'
      AND COALESCE(b.archived, 0) = 0
      AND COALESCE(b.is_stub, 0) = 0
    ORDER BY b.id
  `,
  // Unread books by authors with at least one loved book in the library.
  // Self-exclusion: the loved book itself is filtered out so we don't
  // surface "you loved X — read X." 'where to start' picks across
  // multiple unread candidates by id.
  loved_author_followup: `
    SELECT b.id
    FROM books b
    JOIN book_authors ba ON ba.book_id = b.id AND ba.position = 0
    WHERE ba.author_id IN (
      SELECT DISTINCT ba2.author_id
      FROM book_authors ba2
      JOIN books b2 ON b2.id = ba2.book_id
      WHERE b2.loved = 1
        AND ba2.position = 0
        AND COALESCE(b2.archived, 0) = 0
    )
      AND b.status = 'unread'
      AND COALESCE(b.loved, 0) = 0
      AND COALESCE(b.archived, 0) = 0
      AND COALESCE(b.is_stub, 0) = 0
    ORDER BY b.id
  `,
};

// AI-shaped card types live in the today_card_queue table — content
// is generated in chat with Claude in batches, no API call ever
// happens server-side. Each queue row carries a card_type column
// (migration 074) so the table can hold multiple flavours:
//
//   - 'connection'   cross-author thematic threads ("Howard ↔
//                    Spengler — the Hyborian Age is Decline of the
//                    West with a sword").
//   - 'reading_path' an ordered 5-book sequence with an argument for
//                    the order ("How Roman power thought about itself
//                    — Cicero → Tacitus → Plutarch → Syme").
//
// Selection happens through the same seeded-mod dance as the book
// types, but persistence goes onto the queue row itself (served_at +
// served_date) rather than today_card_history. See routes/today.js
// for the hydration branches.
const QUEUE_CARD_TYPES = Object.freeze(['connection', 'reading_path']);

// Notable round-anniversary year offsets (in years). A book whose
// year_published is exactly N years before the viewed date's year,
// for N in this list, is eligible for the 'anniversary' card. Spread
// thins as we look further back: 25-year steps to 200 catch modern
// works (Moby Dick at 175, Foundation at 75, the Castle at 100,
// Wells's First Men in the Moon at 125, etc.); 250 / 300 / 400 / 500
// reach into the founding-era / early-modern past (Gibbon at 250 in
// 2026); 750 / 1000 / 1500 / 2000 are sparse but keep the door open
// for medieval / ancient works once year_published is filled in for
// them. Hardcoded rather than computed so the rotation feels
// deliberate, not algorithmic.
const ANNIVERSARY_OFFSETS = Object.freeze([
  25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000,
]);

export const CARD_TYPES = Object.freeze([
  ...Object.keys(COHORT_SQL),
  'anniversary',
  ...QUEUE_CARD_TYPES,
]);

const REPETITION_WINDOW_DAYS = 14;

// 'YYYY-MM-DD' → integer like 20260616. Stable per calendar day;
// changes when the day rolls. Used as a seed for type and book
// selection.
function dateSeed(dateStr) {
  return parseInt(String(dateStr).replace(/-/g, ''), 10) || 0;
}

// IDs surfaced as today's card in the last REPETITION_WINDOW_DAYS.
// Used to prune cohorts so a book doesn't show up twice in a window.
function recentlySurfaced(dateStr) {
  const rows = db.prepare(
    `SELECT book_id FROM today_card_history
       WHERE date >  date(?, '-${REPETITION_WINDOW_DAYS} days')
         AND date <= ?`
  ).all(dateStr, dateStr);
  return new Set(rows.map(r => r.book_id));
}

// Pick today's card for the given date. Returns one of:
//   { type, bookId }                  for book-cohort types
//   { type: 'connection'|'reading_path', queueId }   for AI cards
//   null                              when nothing is eligible
// The result is persisted on first compute — book-centric to
// today_card_history, queue-driven to today_card_queue.served_at /
// served_date — and returned verbatim on subsequent calls for the
// same date.
//
// Options:
//   peek      — when true, return persisted card only and DO NOT
//               compute / persist a fresh one. The day-navigation
//               surface on /today passes this for past-date views
//               so the user can scroll back through history without
//               retroactively filling in cards on days they never
//               visited (which would burn the queue and produce
//               odd repetition-guard behaviour).
export function pickTodayCard(dateStr, { peek = false } = {}) {
  // Same-day stability: did we already serve a book-centric card
  // today?
  const existingBook = db.prepare(
    'SELECT type, book_id FROM today_card_history WHERE date = ?'
  ).get(dateStr);
  if (existingBook) {
    return { type: existingBook.type, bookId: existingBook.book_id };
  }
  // Or a queue-driven card (Connection / Reading Path)? Queue card
  // state lives on the queue row itself rather than today_card_history
  // (no book_id to key off) — read card_type back so subsequent
  // hydration knows which renderer to dispatch to.
  const existingQueue = db.prepare(
    'SELECT id, card_type FROM today_card_queue WHERE served_date = ?'
  ).get(dateStr);
  if (existingQueue) {
    return { type: existingQueue.card_type, queueId: existingQueue.id };
  }

  // Past-date view (peek): we've checked both persistence sources and
  // found nothing. Don't compute a fresh card retroactively — that
  // would write a row for a day the user never visited, burning the
  // queue and skewing the repetition guard. Return null and let the
  // client render an empty-state for that day.
  if (peek) return null;

  // Fresh pick. Compute every type's cohort. Book-cohort types
  // strip recently-surfaced books; connection draws from the unserved
  // queue. Seeded mod selects type and id.
  const recent  = recentlySurfaced(dateStr);
  const cohorts = {};
  const eligibleTypes = [];
  for (const type of CARD_TYPES) {
    let ids;
    if (QUEUE_CARD_TYPES.includes(type)) {
      ids = db.prepare(
        'SELECT id FROM today_card_queue WHERE card_type = ? AND served_at IS NULL ORDER BY id'
      ).all(type).map(r => r.id);
    } else if (type === 'anniversary') {
      // Anniversary cohort: books whose year_published is exactly N
      // years before the viewed year, for N in ANNIVERSARY_OFFSETS.
      // Computing targets from dateStr keeps test scenarios with
      // future-dated requests honest (a 2027-01-01 request looks at
      // 2027-N, not whatever the host clock thinks). Skip approximate
      // years — a "ca. 1851" entry shouldn't claim a 175-year
      // anniversary as if it were a known exact date.
      const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
      const targets = ANNIVERSARY_OFFSETS.map(n => dateYear - n);
      const placeholders = targets.map(() => '?').join(',');
      ids = db.prepare(`
        SELECT id FROM books
         WHERE year_published IN (${placeholders})
           AND COALESCE(archived, 0) = 0
           AND COALESCE(is_stub, 0) = 0
           AND COALESCE(year_published_approximate, 0) = 0
         ORDER BY id
      `).all(...targets).map(r => r.id).filter(id => !recent.has(id));
    } else {
      ids = db.prepare(COHORT_SQL[type]).all()
        .map(r => r.id)
        .filter(id => !recent.has(id));
    }
    cohorts[type] = ids;
    if (ids.length) eligibleTypes.push(type);
  }
  if (!eligibleTypes.length) return null;

  const seed   = dateSeed(dateStr);
  const type   = eligibleTypes[seed % eligibleTypes.length];
  const cohort = cohorts[type];
  // Per-type offset so the within-cohort id index isn't always
  // congruent to the type index.
  const offset = CARD_TYPES.indexOf(type) * 17;
  const pickedId = cohort[(seed + offset) % cohort.length];

  if (QUEUE_CARD_TYPES.includes(type)) {
    // Mark the queue row served for this date. served_at fires on
    // first serve only; subsequent same-day fetches re-read it via
    // the existingQueue branch above.
    db.prepare(`
      UPDATE today_card_queue
         SET served_at   = COALESCE(served_at, datetime('now')),
             served_date = COALESCE(served_date, ?)
       WHERE id = ?
    `).run(dateStr, pickedId);
    return { type, queueId: pickedId };
  }

  // Book-centric persistence. INSERT OR IGNORE so a race between two
  // simultaneous requests can't double-write — whichever wins, both
  // end up reading the same row.
  db.prepare(
    'INSERT OR IGNORE INTO today_card_history (date, type, book_id) VALUES (?, ?, ?)'
  ).run(dateStr, type, pickedId);

  return { type, bookId: pickedId };
}

// Computes the type-specific meta that the card body renders. The
// route calls this per request — the meta is NOT persisted because we
// want the rendered text to reflect current book state (a finished
// book whose status changed mid-day shouldn't keep claiming "still
// unread" until midnight). The book row itself comes from getBook()
// in the route layer; the meta here is the SQL queries that need to
// JOIN through other rows (authors, sibling books) to compute their
// numbers. `dateStr` is the viewed date — anniversary cards compute
// years_ago against the request's year, not the host clock.
export function computeCardMeta(type, bookId, dateStr) {
  if (type === 'author_barely_opened' || type === 'loved_author_followup') {
    // Both types pivot on the book's first author. Pull author name +
    // library counts in one query.
    const row = db.prepare(`
      SELECT a.name AS author_name,
             (SELECT COUNT(DISTINCT ba2.book_id)
                FROM book_authors ba2
                JOIN books b2 ON b2.id = ba2.book_id
                WHERE ba2.author_id = a.id
                  AND ba2.position = 0
                  AND COALESCE(b2.archived,0) = 0
                  AND COALESCE(b2.is_stub,0) = 0) AS book_count,
             (SELECT SUM(CASE WHEN b2.status='finished' THEN 1 ELSE 0 END)
                FROM book_authors ba2
                JOIN books b2 ON b2.id = ba2.book_id
                WHERE ba2.author_id = a.id
                  AND ba2.position = 0
                  AND COALESCE(b2.archived,0) = 0
                  AND COALESCE(b2.is_stub,0) = 0) AS finished_count
      FROM book_authors ba
      JOIN authors a ON a.id = ba.author_id
      WHERE ba.book_id = ?
        AND ba.position = 0
      LIMIT 1
    `).get(bookId);
    if (!row) return {};

    const meta = {
      author_name:    row.author_name,
      book_count:     row.book_count    ?? 0,
      finished_count: row.finished_count ?? 0,
    };

    if (type === 'loved_author_followup') {
      // Surface the specific loved title that earned this author the
      // followup. If multiple, pick the highest-rated one as the
      // strongest signal — fall back to first loved.
      const loved = db.prepare(`
        SELECT b.title
        FROM books b
        JOIN book_authors ba ON ba.book_id = b.id AND ba.position = 0
        JOIN book_authors ba_pivot ON ba_pivot.author_id = ba.author_id
        WHERE ba_pivot.book_id = ?
          AND b.loved = 1
          AND COALESCE(b.archived,0) = 0
        ORDER BY COALESCE(b.rating, 0) DESC, b.id
        LIMIT 1
      `).get(bookId);
      if (loved) meta.loved_title = loved.title;
    }
    return meta;
  }
  if (type === 'anniversary') {
    const row = db.prepare('SELECT year_published FROM books WHERE id = ?').get(bookId);
    if (!row?.year_published) return {};
    const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
    return {
      year_published: row.year_published,
      years_ago:      dateYear - row.year_published,
    };
  }
  return {};
}
