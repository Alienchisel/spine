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
  // Owned, unread "next volume" in a series the user has already
  // started: for each series with at least one finished volume, pick
  // the smallest unread series_number that's greater than the
  // furthest-finished number. Half-volumes (1.5, 3.5) are handled
  // naturally by the > comparison. The PARTITION BY ... ROW_NUMBER
  // pattern keeps the cohort to ONE book per eligible series — the
  // immediate next volume only, not every later unread volume.
  //
  // Owned=1 filter is the key shape difference from
  // loved_author_followup: this cohort only nudges for books actually
  // on the shelf. If the user finished Vol 3 but doesn't own Vol 4,
  // we stay quiet rather than pushing a buy prompt.
  series_next_volume: `
    WITH series_progress AS (
      SELECT series, MAX(series_number) AS max_finished
        FROM books
       WHERE series IS NOT NULL AND series != ''
         AND status = 'finished'
         AND series_number IS NOT NULL
         AND COALESCE(archived, 0) = 0
       GROUP BY series
    ),
    candidates AS (
      SELECT b.id, b.series, b.series_number,
             ROW_NUMBER() OVER (
               PARTITION BY b.series
               ORDER BY b.series_number ASC, b.id ASC
             ) AS rn
        FROM books b
        JOIN series_progress sp ON sp.series = b.series
       WHERE b.status = 'unread'
         AND b.owned  = 1
         AND b.series_number IS NOT NULL
         AND b.series_number > sp.max_finished
         AND COALESCE(b.archived, 0) = 0
         AND COALESCE(b.is_stub, 0) = 0
    )
    SELECT id FROM candidates WHERE rn = 1 ORDER BY id
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

// Personal-anniversary offsets — applied against the user's own diary
// (date_finished) and acquisition history (acquisition_date), so the
// space is short and recency-biased. 'You finished X one year ago
// today' is the canonical shape; the longer offsets reach into the
// pre-Spine paper-diary era as the library accumulates dated reads.
// Distinct from ANNIVERSARY_OFFSETS because the user's lifetime sets a
// hard ceiling here and 25-year steps would mostly miss.
const PERSONAL_ANNIVERSARY_OFFSETS = Object.freeze([1, 2, 3, 5, 10, 15, 20]);

export const CARD_TYPES = Object.freeze([
  ...Object.keys(COHORT_SQL),
  'personal_anniversary',
  'anniversary',
  'author_anniversary',
  ...QUEUE_CARD_TYPES,
]);

const REPETITION_WINDOW_DAYS = 14;

// 'YYYY-MM-DD' → integer like 20260616. Stable per calendar day;
// changes when the day rolls. Used as a seed for type and book
// selection.
function dateSeed(dateStr) {
  return parseInt(String(dateStr).replace(/-/g, ''), 10) || 0;
}

// Pull a calendar year out of a partial-date string: 'YYYY' / 'YYYY-MM'
// / 'YYYY-MM-DD' / '-YYYY' (BCE) / '-YY-MM-DD'. Returns null on no
// parseable leading-year token. The leading `-` is preserved so BCE
// authors (Plato '-428' / Ovid '-43-03-20') yield negative years.
function yearOf(str) {
  if (str == null) return null;
  const m = String(str).match(/^-?\d{1,4}/);
  return m ? parseInt(m[0], 10) : null;
}

// "Where to start" promotion for author-scoped card types. The cohort
// selection picks any unread book by an under-read author, ordered
// by id; left raw, that surfaces whatever happened to be added last
// — for a multi-volume series the user owns front-to-back, that's
// the deepest volume (e.g., Thermæ Romæ Vol 5 instead of Vol 1).
//
// This function takes the cohort's picked bookId and returns a
// better entry-point sibling by the same first author when one
// exists: prefer series_number=1 of any series, then standalones
// (no series), then lower series numbers, then anything else.
// Falls back to the original bookId when the promoted candidate
// is already in the recently-surfaced set (so promotion can't
// break the 14-day repetition guard the cohort pre-filter enforces).
//
// `excludeLoved=true` is set by callers whose cohort filters loved
// books out — without it the promotion could re-surface the loved
// anchor as the entry-point for loved_author_followup.
function promoteToEntryPoint(bookId, recent, { excludeLoved = false } = {}) {
  const lovedClause = excludeLoved ? 'AND COALESCE(b.loved, 0) = 0' : '';
  const candidates = db.prepare(`
    SELECT b.id, b.series_number
      FROM books b
      JOIN book_authors ba ON ba.book_id = b.id AND ba.position = 0
     WHERE ba.author_id = (
             SELECT author_id FROM book_authors
              WHERE book_id = ? AND position = 0
           )
       AND b.status = 'unread'
       AND COALESCE(b.archived, 0) = 0
       AND COALESCE(b.is_stub, 0) = 0
       ${lovedClause}
     ORDER BY
       CASE
         WHEN b.series_number = 1 THEN 0          -- Series Vol 1 wins outright
         WHEN b.series IS NULL OR b.series = '' THEN 1  -- Standalones next
         ELSE 2                                    -- Other series volumes last
       END,
       COALESCE(b.series_number, 9999) ASC,        -- Within tier, lowest volume first
       COALESCE(b.page_count, 99999) ASC,          -- Then shortest as a proxy for "easy start"
       b.id ASC
  `).all(bookId);
  // Walk candidates in preference order; the first one that's not
  // already in the recently-surfaced window wins. If they're all
  // blocked, leave the cohort's original pick alone.
  for (const c of candidates) {
    if (!recent.has(c.id)) return c.id;
  }
  return bookId;
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
    } else if (type === 'personal_anniversary') {
      // Personal-anniversary cohort: books whose date_finished OR
      // acquisition_date lands on today's MM-DD a notable number of
      // years ago (PERSONAL_ANNIVERSARY_OFFSETS). The substr-based
      // MM-DD match auto-filters partial-date entries (YYYY,
      // YYYY-MM) — they won't equal the 5-char "MM-DD" tail of a
      // full dateStr, so they drop out cleanly. UNION ALL keeps both
      // events available; the per-id Map dedupes when one book hits
      // both, preferring 'finished' as the stronger emotional signal.
      const rows = db.prepare(`
        SELECT id, 'finished' AS event, date_finished AS event_date
          FROM books
         WHERE date_finished IS NOT NULL
           AND substr(date_finished, 6, 5) = substr(?, 6, 5)
           AND COALESCE(archived, 0) = 0
        UNION ALL
        SELECT id, 'acquired' AS event, acquisition_date AS event_date
          FROM books
         WHERE acquisition_date IS NOT NULL
           AND substr(acquisition_date, 6, 5) = substr(?, 6, 5)
           AND COALESCE(archived, 0) = 0
           AND COALESCE(is_stub, 0) = 0
      `).all(dateStr, dateStr);
      const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
      const byId = new Map();
      for (const r of rows) {
        const ey = parseInt(String(r.event_date).slice(0, 4), 10) || 0;
        const delta = dateYear - ey;
        if (!PERSONAL_ANNIVERSARY_OFFSETS.includes(delta)) continue;
        // 'finished' wins over 'acquired' when both events match the
        // same MM-DD on the same book.
        const existing = byId.get(r.id);
        if (existing && existing.event === 'finished') continue;
        byId.set(r.id, r);
      }
      ids = [...byId.keys()].sort((a, b) => a - b).filter(id => !recent.has(id));
    } else if (type === 'anniversary') {
      // Anniversary cohort: books whose year_published is exactly N
      // years before the viewed year, for N in ANNIVERSARY_OFFSETS.
      // Computing targets from dateStr keeps test scenarios with
      // future-dated requests honest (a 2027-01-01 request looks at
      // 2027-N, not whatever the host clock thinks). Skip approximate
      // years — a "ca. 1851" entry shouldn't claim a 175-year
      // anniversary as if it were a known exact date.
      //
      // Dedupe by work_id: a user who owns four editions of Moby Dick
      // shouldn't see each independently eligible for the 175-year
      // anniversary cohort. GROUP BY COALESCE(work_id, -id) collapses
      // edition siblings to MIN(id) while keeping unlinked books
      // (NULL work_id) as their own groups via the negated-id trick.
      const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
      const targets = ANNIVERSARY_OFFSETS.map(n => dateYear - n);
      const placeholders = targets.map(() => '?').join(',');
      ids = db.prepare(`
        SELECT MIN(id) AS id FROM books
         WHERE year_published IN (${placeholders})
           AND COALESCE(archived, 0) = 0
           AND COALESCE(is_stub, 0) = 0
           AND COALESCE(year_published_approximate, 0) = 0
         GROUP BY COALESCE(work_id, -id)
         ORDER BY id
      `).all(...targets).map(r => r.id).filter(id => !recent.has(id));
    } else if (type === 'author_anniversary') {
      // Author-anniversary cohort: books whose first author has a
      // birth_date or death_date year exactly N years before the
      // viewed year, for N in ANNIVERSARY_OFFSETS. Year extraction
      // is done in JS (the date column is partial-date TEXT — yYYYY,
      // YYYY-MM, YYYY-MM-DD, '-YYYY' for BCE) and the resulting
      // matching-author set is passed to a single book join.
      //
      // GROUP BY ba.author_id picks one book per anniversary author
      // (MIN(id) — promoted to a series Vol 1 by the where-to-start
      // promotion downstream). One anniversary author should surface
      // ONCE, not once per book in the library by them.
      const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
      const targets = new Set(ANNIVERSARY_OFFSETS.map(n => dateYear - n));
      const authorRows = db.prepare(
        'SELECT id, birth_date, death_date FROM authors WHERE birth_date IS NOT NULL OR death_date IS NOT NULL'
      ).all();
      const matchingAuthors = authorRows.filter(a => {
        const by = yearOf(a.birth_date);
        const dy = yearOf(a.death_date);
        return (by != null && targets.has(by)) || (dy != null && targets.has(dy));
      }).map(a => a.id);
      if (matchingAuthors.length === 0) {
        ids = [];
      } else {
        const ph = matchingAuthors.map(() => '?').join(',');
        ids = db.prepare(`
          SELECT MIN(b.id) AS id
            FROM books b
            JOIN book_authors ba ON ba.book_id = b.id AND ba.position = 0
           WHERE ba.author_id IN (${ph})
             AND COALESCE(b.archived, 0) = 0
             AND COALESCE(b.is_stub, 0) = 0
           GROUP BY ba.author_id
           ORDER BY MIN(b.id)
        `).all(...matchingAuthors).map(r => r.id).filter(id => !recent.has(id));
      }
    } else {
      ids = db.prepare(COHORT_SQL[type]).all()
        .map(r => r.id)
        .filter(id => !recent.has(id));
    }
    cohorts[type] = ids;
    if (ids.length) eligibleTypes.push(type);
  }
  // Tiebreaker — personal_anniversary outranks work-publication
  // anniversary when both are eligible. The user's own reading
  // history is the more emotionally salient anchor; on the rare day
  // they both fire, the personal one wins outright. Pre-pruning the
  // eligible list keeps the seeded selection clean — we don't need a
  // per-type weight or a special case downstream.
  if (eligibleTypes.includes('personal_anniversary')
      && eligibleTypes.includes('anniversary')) {
    const idx = eligibleTypes.indexOf('anniversary');
    eligibleTypes.splice(idx, 1);
  }
  if (!eligibleTypes.length) return null;

  const seed   = dateSeed(dateStr);
  const type   = eligibleTypes[seed % eligibleTypes.length];
  const cohort = cohorts[type];
  // Per-type offset so the within-cohort id index isn't always
  // congruent to the type index.
  const offset = CARD_TYPES.indexOf(type) * 17;
  let pickedId = cohort[(seed + offset) % cohort.length];

  // Author-scoped types: promote the cohort pick to a better "where
  // to start" sibling by the same author (series Vol 1, standalone,
  // etc.). The seed still determines WHICH author surfaces; only the
  // within-author book is reconsidered. Skips books in the
  // recently-surfaced window so promotion can't bypass the
  // repetition guard.
  if (type === 'author_barely_opened') {
    pickedId = promoteToEntryPoint(pickedId, recent);
  } else if (type === 'loved_author_followup') {
    pickedId = promoteToEntryPoint(pickedId, recent, { excludeLoved: true });
  } else if (type === 'author_anniversary') {
    // Same series-Vol-1/standalone heuristic as the other author-
    // scoped types. Surfacing Lovecraft's 100th death anniversary
    // with "Try The Tomb (Vol 1)" beats "Try Some Random Story."
    pickedId = promoteToEntryPoint(pickedId, recent);
  } else if (type === 'anniversary') {
    // Stratified offset pick. The raw seed-mod against a flat cohort
    // gives every book equal odds, which means a 25-book 25y bucket
    // drowns a single-book 1500y bucket (5% vs 0.06% of anniversary
    // days). Group cohort books by offset (viewed_year - year_pub),
    // pick the offset uniformly across distinct buckets, then pick a
    // book uniformly within the bucket. Every offset that exists gets
    // equal billing — a 2000-year-old book becomes a guaranteed event
    // when its offset is in play, not a near-impossibility.
    const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
    const annoPlaceholders = cohort.map(() => '?').join(',');
    const yearRows = db.prepare(
      `SELECT id, year_published FROM books WHERE id IN (${annoPlaceholders})`
    ).all(...cohort);
    const buckets = new Map();
    for (const r of yearRows) {
      const o = dateYear - r.year_published;
      if (!buckets.has(o)) buckets.set(o, []);
      buckets.get(o).push(r.id);
    }
    const offsetList = [...buckets.keys()].sort((a, b) => a - b);
    const pickedOffset = offsetList[seed % offsetList.length];
    const inner = buckets.get(pickedOffset);
    pickedId = inner[(seed + 7) % inner.length];  // +7 = small offset to vary within-bucket pick
  }

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
  if (type === 'series_next_volume') {
    // Look up the previous volume — the furthest-finished sibling in
    // this book's series. Cohort SQL guarantees one exists or this
    // book wouldn't have been picked. days_since_prev uses SQLite
    // julianday so the diff is a whole calendar-day count, per the
    // project's no-ms-arithmetic-for-days rule.
    const surfaced = db.prepare(
      'SELECT series, series_number FROM books WHERE id = ?'
    ).get(bookId);
    if (!surfaced?.series) return {};
    const prev = db.prepare(`
      SELECT title, series_number AS volume, date_finished,
             CAST(julianday(?) - julianday(date_finished) AS INTEGER) AS days_since_prev
        FROM books
       WHERE series = ?
         AND status = 'finished'
         AND series_number IS NOT NULL
         AND COALESCE(archived, 0) = 0
       ORDER BY series_number DESC, id DESC
       LIMIT 1
    `).get(dateStr, surfaced.series);
    if (!prev) return {};
    return {
      series:          surfaced.series,
      next_volume:     surfaced.series_number,
      prev_volume:     prev.volume,
      prev_title:      prev.title,
      days_since_prev: prev.days_since_prev,
    };
  }
  if (type === 'personal_anniversary') {
    // Re-discover which event (finished vs acquired) matches the
    // viewed MM-DD with a year delta in PERSONAL_ANNIVERSARY_OFFSETS.
    // Pattern mirrors author_anniversary's birth-vs-death derivation —
    // the cohort selection narrowed to this book; here we recover the
    // specific event for rendering. 'finished' wins over 'acquired'
    // when both match on the same date, matching the cohort dedupe.
    const row = db.prepare(
      'SELECT date_finished, acquisition_date FROM books WHERE id = ?'
    ).get(bookId);
    if (!row) return {};
    const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
    const dateMD   = String(dateStr).slice(5, 10);
    const tryEvent = (eventDate, eventName) => {
      if (!eventDate || String(eventDate).slice(5, 10) !== dateMD) return null;
      const ey = parseInt(String(eventDate).slice(0, 4), 10) || 0;
      const delta = dateYear - ey;
      if (!PERSONAL_ANNIVERSARY_OFFSETS.includes(delta)) return null;
      return { event: eventName, event_year: ey, years_ago: delta };
    };
    const match = tryEvent(row.date_finished, 'finished')
               || tryEvent(row.acquisition_date, 'acquired');
    return match || {};
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
  if (type === 'author_anniversary') {
    // Author's birth_date / death_date are partial-date TEXT — extract
    // the year via yearOf and match against ANNIVERSARY_OFFSETS to
    // pick which event (birth vs death) the cohort matched on. Death
    // is preferred when both apply because it's the more poignant
    // anniversary, and a "born N + died M" coincidence picks death.
    const row = db.prepare(`
      SELECT a.name, a.birth_date, a.death_date,
        (SELECT COUNT(DISTINCT ba2.book_id)
           FROM book_authors ba2 JOIN books b2 ON b2.id = ba2.book_id
          WHERE ba2.author_id = a.id
            AND ba2.position = 0
            AND COALESCE(b2.archived, 0) = 0
            AND COALESCE(b2.is_stub, 0) = 0) AS book_count
        FROM book_authors ba
        JOIN authors a ON a.id = ba.author_id
       WHERE ba.book_id = ? AND ba.position = 0
       LIMIT 1
    `).get(bookId);
    if (!row) return {};
    const dateYear = parseInt(String(dateStr).slice(0, 4), 10) || 0;
    const byYear = yearOf(row.birth_date);
    const dyYear = yearOf(row.death_date);
    const matches = (y) => y != null && ANNIVERSARY_OFFSETS.includes(dateYear - y);
    const event = matches(dyYear) ? 'death' : matches(byYear) ? 'birth' : null;
    const eventYear = event === 'death' ? dyYear : byYear;
    if (!event || eventYear == null) return {};
    return {
      author_name: row.name,
      event,
      event_year:  eventYear,
      years_ago:   dateYear - eventYear,
      book_count:  row.book_count || 0,
    };
  }
  return {};
}
