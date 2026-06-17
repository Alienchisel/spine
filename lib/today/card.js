import db from '../../db.js';

// v0 of the daily "Today" card mix. Three deterministic card types
// computed entirely from local SQL — no AI calls, costs nothing.
// Selection is stable per calendar day so a refresh during the day
// returns the same card; midnight rolls a new one. The eventual mix
// will include AI-generated Connection + Reading-path cards drawn
// from a curated queue (see the design discussion in 2026-06 — those
// types live on top of this same selection scaffolding).
//
// Type cohort rules:
//   - loved_resurface     — books the user marked loved and last
//                           opened more than six months ago. The
//                           "you loved this, when did you last open it?"
//                           prompt.
//   - slow_burn           — books status='reading' with a date_started
//                           older than 30 days. The pace-check nudge.
//   - recent_acquisition  — owned books bought in the last 14 days
//                           that haven't been started yet. The
//                           "you just bought this — slot it in?" prompt.
//
// All three exclude archived books. recent_acquisition also excludes
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
};

export const CARD_TYPES = Object.freeze(Object.keys(COHORT_SQL));

// 'YYYY-MM-DD' → integer like 20260616. Stable per calendar day;
// changes when the day rolls. Used as a seed for type and book
// selection so refreshes during the day return the same card.
function dateSeed(dateStr) {
  return parseInt(String(dateStr).replace(/-/g, ''), 10) || 0;
}

// Pick a card for the given date. Returns { type, bookId, eligibleTypes }
// or null when nothing in the library matches any cohort (fresh DB or a
// library with no loved books / no reading books / no recent buys).
export function pickTodayCard(dateStr) {
  const cohorts = {};
  const eligibleTypes = [];
  for (const type of CARD_TYPES) {
    const ids = db.prepare(COHORT_SQL[type]).all().map(r => r.id);
    cohorts[type] = ids;
    if (ids.length) eligibleTypes.push(type);
  }
  if (!eligibleTypes.length) return null;

  const seed = dateSeed(dateStr);
  const type = eligibleTypes[seed % eligibleTypes.length];
  // Small per-type offset (the index in the canonical type ordering
  // times 17) so the within-cohort book pick doesn't collide with the
  // type pick on the same seed — without it every loved_resurface day
  // would hit the same loved book.
  const cohort  = cohorts[type];
  const offset  = CARD_TYPES.indexOf(type) * 17;
  const bookId  = cohort[(seed + offset) % cohort.length];
  return { type, bookId, eligibleTypes };
}
