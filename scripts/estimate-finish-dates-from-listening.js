#!/usr/bin/env node
// Estimate audiobook start / finish dates and re-reads from the Audible
// Listening CSV, by walking each ASIN's events in chronological order
// and watching the End Position relative to Book Length.
//
// Usage:
//   node scripts/estimate-finish-dates-from-listening.js <csv-path>            # dry-run
//   node scripts/estimate-finish-dates-from-listening.js <csv-path> --apply
//
// Detection rules per ASIN:
//   - "Completion" = an event whose End Position ≥ COMPLETION_THRESHOLD ×
//     Book Length (default 95%). The last few minutes of an audiobook are
//     often outros / credits, so a strict 100% misses real completions.
//   - "Re-read start" = an event whose Start Position < RESTART_THRESHOLD
//     (default 5%) AFTER the per-read peak crossed PEAK_REQUIRED (50%).
//     This way, jumping back briefly mid-read doesn't count, but a real
//     "play this again from the beginning" does.
//   - Per read: start_date = first event's date, finish_date = the date
//     of the first completion event in that read.
//
// Apply behaviour:
//   - Only writes when Spine's existing date is NULL — never overwrites
//     a manually-entered date. (Re-runs are idempotent.)
//   - Inserts one reads-table row per detected completion that doesn't
//     already exist (matched by book_id + finish_date).
//   - Sets books.read_count to max(existing, detected) — so manual
//     bookkeeping isn't lost if the user has already counted a re-read.
//   - Sets books.status='finished' if at least one completion was
//     detected and the book wasn't already finished.

import fs from 'fs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/estimate-finish-dates-from-listening.js <csv-path> [--apply]');
  process.exit(1);
}

const COMPLETION_THRESHOLD = 0.95;            // event end >= 95% of book length → completion
const RESTART_THRESHOLD    = 0.05;            // event start < 5% → potential re-read
const PEAK_REQUIRED        = 0.50;            // re-read only counts if previous peak ≥ 50%
const MIN_EVENT_MS         = 60000;           // ignore events under 60s (consistent with diary import)
const RE_READ_MIN_GAP_DAYS = 7;               // require this many days since the last completion
                                              // before counting a "scrub back to start" as a new read.
                                              // Without this, a user paging around in a short-story
                                              // collection produces phantom re-reads.

function daysBetween(a, b) {
  // Both arguments are 'YYYY-MM-DD' strings; treat as UTC midnight to
  // sidestep DST. Returns |b - a| in calendar days (rounded).
  const ms = Math.abs(Date.UTC(...a.split('-').map((v, i) => i === 1 ? +v - 1 : +v))
                    - Date.UTC(...b.split('-').map((v, i) => i === 1 ? +v - 1 : +v)));
  return Math.round(ms / 86400000);
}

// ─── CSV parsing ───────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"')                   { inQuote = false; }
      else                                  { field += c; }
    } else {
      if (c === '"')        { inQuote = true; }
      else if (c === ',')   { row.push(field); field = ''; }
      else if (c === '\r')  { /* skip */ }
      else if (c === '\n')  { row.push(field); field = ''; rows.push(row); row = []; }
      else                  { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const csvText = fs.readFileSync(csvPath, 'utf8');
const allRows = parseCsv(csvText).filter(r => r.length > 1);
const header = allRows.shift();
const I_START_DATE  = header.indexOf('Start Date');
const I_DURATION_MS = header.indexOf('Event Duration Milliseconds');
const I_START_POS   = header.indexOf('Start Position Milliseconds');
const I_END_POS     = header.indexOf('End Position Milliseconds');
const I_PRODUCT     = header.indexOf('Product Name');
const I_ASIN        = header.indexOf('ASIN');
const I_BOOK_LEN    = header.indexOf('Book Length Milliseconds');

// ─── Per-ASIN aggregation ──────────────────────────────────────────────

const eventsByAsin = new Map(); // asin → [{ date, durationMs, startPos, endPos }]
const productByAsin = new Map();
const bookLengthByAsin = new Map();

for (const r of allRows) {
  const asin = r[I_ASIN];
  if (!asin) continue;
  const durationMs = parseInt(r[I_DURATION_MS], 10);
  if (!Number.isFinite(durationMs) || durationMs < MIN_EVENT_MS) continue;
  const event = {
    date:       r[I_START_DATE],
    durationMs,
    startPos:   parseInt(r[I_START_POS], 10) || 0,
    endPos:     parseInt(r[I_END_POS], 10) || 0,
  };
  if (!eventsByAsin.has(asin)) eventsByAsin.set(asin, []);
  eventsByAsin.get(asin).push(event);
  productByAsin.set(asin, r[I_PRODUCT]);
  const bl = parseInt(r[I_BOOK_LEN], 10);
  if (Number.isFinite(bl) && bl > 0) bookLengthByAsin.set(asin, bl);
}

// ─── Per-ASIN read detection ───────────────────────────────────────────

// Walks events for one ASIN in chronological order, returns:
//   { reads: [{ startDate, finishDate }], started: bool, finished: bool }
function detectReads(events, bookLength) {
  // Stable sort by date string (ISO lexicographically sorts correctly).
  events = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const completionThresholdMs = Math.floor(bookLength * COMPLETION_THRESHOLD);
  const restartThresholdMs    = Math.floor(bookLength * RESTART_THRESHOLD);
  const peakRequiredMs        = Math.floor(bookLength * PEAK_REQUIRED);

  const reads = [];
  let startDate = null;     // current read start
  let peak = 0;             // peak position reached in current read
  let finishedCurrent = false;
  let lastFinishDate = null; // date of the most recent completion (any read)

  for (const e of events) {
    // Re-read trigger: position reset to near 0 after we'd reached at least
    // 50% in the current read AND it's been at least RE_READ_MIN_GAP_DAYS
    // since the prior completion (so a same-week scrub-back doesn't count
    // as a new read). For non-finished current reads (just deep into a
    // book), the gap rule still applies relative to the last actual
    // completion — fall back to no-gap-required if there's never been a
    // completion yet.
    if (startDate !== null && e.startPos < restartThresholdMs && peak >= peakRequiredMs) {
      const farEnoughFromLastFinish = !lastFinishDate || daysBetween(lastFinishDate, e.date) >= RE_READ_MIN_GAP_DAYS;
      if (farEnoughFromLastFinish) {
        startDate = e.date;
        peak = e.endPos;
        finishedCurrent = false;
      }
      // Otherwise: treat as a within-read scrub-back; don't reset.
    }
    if (startDate === null) {
      startDate = e.date;
      peak = 0;
      finishedCurrent = false;
    }
    if (e.endPos > peak) peak = e.endPos;
    if (!finishedCurrent && e.endPos >= completionThresholdMs) {
      reads.push({ startDate, finishDate: e.date });
      finishedCurrent = true;
      lastFinishDate = e.date;
    }
  }

  return {
    reads,
    started: startDate !== null,
    finished: reads.length > 0,
  };
}

// ─── Match to Spine + plan ────────────────────────────────────────────

const { default: db } = await import('../db.js');

const audiobooks = db.prepare(
  "SELECT id, title, asin, status, date_started, date_finished, read_count FROM books WHERE format = 'audiobook' AND asin IS NOT NULL AND asin != ''"
).all();

const existingReadDates = new Map(); // book_id → Set of date_finished strings
for (const r of db.prepare(
  "SELECT book_id, date_finished FROM reads WHERE date_finished IS NOT NULL"
).all()) {
  if (!existingReadDates.has(r.book_id)) existingReadDates.set(r.book_id, new Set());
  existingReadDates.get(r.book_id).add(r.date_finished);
}

const plans = []; // { book, computed, patchBook, insertReads, statusChange }
let unmatched = 0;

for (const book of audiobooks) {
  const events = eventsByAsin.get(book.asin);
  const bookLength = bookLengthByAsin.get(book.asin);
  if (!events || !bookLength) { unmatched++; continue; }
  const result = detectReads(events, bookLength);

  const earliestStart  = result.reads[0]?.startDate || (result.started ? events.sort((a,b)=>a.date.localeCompare(b.date))[0].date : null);
  const latestFinish   = result.reads[result.reads.length - 1]?.finishDate || null;
  const detectedReadCount = result.reads.length;

  // Plan only the cells we'd change.
  const patchBook = {};
  if (!book.date_started && earliestStart)        patchBook.date_started = earliestStart;
  if (!book.date_finished && latestFinish)        patchBook.date_finished = latestFinish;
  // read_count: don't shrink — only bump.
  if (detectedReadCount > (book.read_count || 0)) patchBook.read_count = detectedReadCount;
  // Status flip: only if we have a completion and Spine doesn't already say
  // 'finished'. Don't downgrade reading→unread or anything else.
  let statusChange = null;
  if (latestFinish && book.status !== 'finished') statusChange = 'finished';

  // Reads rows: insert any detected completion whose date_finished isn't
  // already on file for this book.
  const existing = existingReadDates.get(book.id) || new Set();
  const insertReads = result.reads.filter(r => !existing.has(r.finishDate));

  if (Object.keys(patchBook).length > 0 || insertReads.length > 0 || statusChange) {
    plans.push({ book, computed: result, patchBook, insertReads, statusChange });
  }
}

// ─── Report ────────────────────────────────────────────────────────────

const dateRangeForPlan = (() => {
  const dates = plans.flatMap(p => p.computed.reads.flatMap(r => [r.startDate, r.finishDate])).filter(Boolean).sort();
  return dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '(none)';
})();

console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'}\n`);
console.log(`Audiobooks with ASIN:        ${audiobooks.length}`);
console.log(`No CSV listening data:       ${unmatched}`);
console.log(`Books with proposed changes: ${plans.length}`);
console.log(`Date range:                  ${dateRangeForPlan}`);

let totalReadsInserted = 0;
let totalDateStartedFilled = 0;
let totalDateFinishedFilled = 0;
let totalReadCountBumped = 0;
let totalStatusChanged = 0;

for (const p of plans) {
  const lines = [];
  if (p.patchBook.date_started)  { lines.push(`date_started=${p.patchBook.date_started}`); totalDateStartedFilled++; }
  if (p.patchBook.date_finished) { lines.push(`date_finished=${p.patchBook.date_finished}`); totalDateFinishedFilled++; }
  if (p.patchBook.read_count != null) { lines.push(`read_count ${p.book.read_count || 0}→${p.patchBook.read_count}`); totalReadCountBumped++; }
  if (p.statusChange)            { lines.push(`status→${p.statusChange}`); totalStatusChanged++; }
  if (p.insertReads.length > 0)  { lines.push(`+${p.insertReads.length} reads row(s): ${p.insertReads.map(r => `${r.startDate}→${r.finishDate}`).join(', ')}`); totalReadsInserted += p.insertReads.length; }
  console.log(`  id=${String(p.book.id).padStart(4)}  ${p.book.title.slice(0, 50).padEnd(50)}  ${lines.join('; ')}`);
}

console.log(`\nSummary:`);
console.log(`  date_started filled:  ${totalDateStartedFilled}`);
console.log(`  date_finished filled: ${totalDateFinishedFilled}`);
console.log(`  read_count bumped:    ${totalReadCountBumped}`);
console.log(`  status → finished:    ${totalStatusChanged}`);
console.log(`  reads rows to insert: ${totalReadsInserted}`);

// ─── Apply ─────────────────────────────────────────────────────────────

if (!apply) {
  console.log(`\nDry-run only. Re-run with --apply to write changes.`);
  process.exit(0);
}

const updateBook = db.prepare(`
  UPDATE books SET
    date_started  = COALESCE(?, date_started),
    date_finished = COALESCE(?, date_finished),
    read_count    = COALESCE(?, read_count),
    status        = COALESCE(?, status),
    updated_at    = datetime('now', 'localtime')
  WHERE id = ?
`);
const insertRead = db.prepare(`
  INSERT INTO reads (book_id, date_started, date_finished, created_at)
  VALUES (?, ?, ?, datetime('now', 'localtime'))
`);

const txn = db.transaction((plans) => {
  for (const p of plans) {
    updateBook.run(
      p.patchBook.date_started ?? null,
      p.patchBook.date_finished ?? null,
      p.patchBook.read_count ?? null,
      p.statusChange ?? null,
      p.book.id
    );
    for (const r of p.insertReads) {
      insertRead.run(p.book.id, r.startDate, r.finishDate);
    }
  }
});
txn(plans);

console.log(`\nApplied ${plans.length} books, ${totalReadsInserted} reads rows.`);
