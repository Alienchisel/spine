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

export const CARD_TYPES = Object.freeze(Object.keys(COHORT_SQL));

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

// Pick today's card for the given date. Returns { type, bookId } or
// null when no cohort is eligible. The result is persisted to
// today_card_history on first compute and returned verbatim on
// subsequent calls for the same date.
export function pickTodayCard(dateStr) {
  // Same-day stability: if we've already chosen a card for this date,
  // return that. The card text gets recomputed by the route from
  // current book state — only (type, bookId) is frozen.
  const existing = db.prepare(
    'SELECT type, book_id FROM today_card_history WHERE date = ?'
  ).get(dateStr);
  if (existing) {
    return { type: existing.type, bookId: existing.book_id };
  }

  // Fresh pick. Compute every type's cohort, strip recently-surfaced
  // books, then run the seeded type + book modulo.
  const recent = recentlySurfaced(dateStr);
  const cohorts = {};
  const eligibleTypes = [];
  for (const type of CARD_TYPES) {
    const ids = db.prepare(COHORT_SQL[type]).all()
      .map(r => r.id)
      .filter(id => !recent.has(id));
    cohorts[type] = ids;
    if (ids.length) eligibleTypes.push(type);
  }
  if (!eligibleTypes.length) return null;

  const seed   = dateSeed(dateStr);
  const type   = eligibleTypes[seed % eligibleTypes.length];
  const cohort = cohorts[type];
  // Per-type offset so the within-cohort book index isn't always
  // congruent to the type index — without it, every day landing on
  // loved_resurface would surface the same book until the cohort
  // changed.
  const offset = CARD_TYPES.indexOf(type) * 17;
  const bookId = cohort[(seed + offset) % cohort.length];

  // Persist. INSERT OR IGNORE so a race between two simultaneous
  // requests can't double-write — whichever wins, both end up reading
  // the same row.
  db.prepare(
    'INSERT OR IGNORE INTO today_card_history (date, type, book_id) VALUES (?, ?, ?)'
  ).run(dateStr, type, bookId);

  return { type, bookId };
}

// Computes the type-specific meta that the card body renders. The
// route calls this per request — the meta is NOT persisted because we
// want the rendered text to reflect current book state (a finished
// book whose status changed mid-day shouldn't keep claiming "still
// unread" until midnight). The book row itself comes from getBook()
// in the route layer; the meta here is the SQL queries that need to
// JOIN through other rows (authors, sibling books) to compute their
// numbers.
export function computeCardMeta(type, bookId) {
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
  return {};
}
