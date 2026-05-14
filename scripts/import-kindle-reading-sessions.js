#!/usr/bin/env node
// Import Kindle "Reading Session" CSV export into Spine's reading_log table.
//
// Usage:
//   node scripts/import-kindle-reading-sessions.js <csv-path>            # dry-run
//   node scripts/import-kindle-reading-sessions.js <csv-path> --apply
//   node scripts/import-kindle-reading-sessions.js <csv-path> --min-event-seconds=60
//
// Each CSV row is a single Kindle reading session. We group by (ASIN, date),
// sum total_reading_millis, convert to minutes, and upsert into the reading_log
// table — using the same ON CONFLICT(book_id, date) WHERE story_id IS NULL
// shape as the Audible importer, so re-running is idempotent.
//
// Date derivation: prefer end_timestamp, fall back to start_timestamp. Both
// can be literal "Not Available" in this export; rows with neither are
// dropped. Timestamps are ISO 8601 in UTC (Z suffix); we extract the UTC
// date — matches what the one-off backfill for #644 wrote, so re-running
// over the same range converges. If you want local-date semantics, convert
// the CSV upstream.
//
// Filtering: sessions shorter than `--min-event-seconds` (default 60) are
// dropped before grouping. Mirrors the Audible importer — excludes the
// accidental opens and brief app foregrounding the Kindle device records.
//
// Pages: pages_read is written as 0. Kindle's number_of_page_flips field
// counts every page navigation event (including back-flips and lookups),
// so its sum can easily overshoot the true forward progress. Diary captures
// engaged-reading minutes; current_page captures position. They're orthogonal.

import fs from 'fs';

// ─── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const minEventSecondsArg = args.find(a => a.startsWith('--min-event-seconds='));
const minEventSeconds = minEventSecondsArg ? parseInt(minEventSecondsArg.split('=')[1], 10) : 60;
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/import-kindle-reading-sessions.js <csv-path> [--apply] [--min-event-seconds=N]');
  process.exit(1);
}
if (!Number.isFinite(minEventSeconds) || minEventSeconds < 0) {
  console.error('Invalid --min-event-seconds');
  process.exit(1);
}
const minEventMs = minEventSeconds * 1000;

// ─── CSV parsing ───────────────────────────────────────────────────────

// Kindle's CSV is RFC-4180-ish: comma-separated, fields may be quoted with ".
// The export ships with a UTF-8 BOM on the first line; strip it before parsing
// so the first header isn't unmatchable.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
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
const idx = (name) => header.indexOf(name);

const I_START_TS  = idx('start_timestamp');
const I_END_TS    = idx('end_timestamp');
const I_ASIN      = idx('ASIN');
const I_MILLIS    = idx('total_reading_millis');

if ([I_START_TS, I_END_TS, I_ASIN, I_MILLIS].some(v => v < 0)) {
  console.error('CSV missing required columns (start_timestamp, end_timestamp, ASIN, total_reading_millis)');
  process.exit(1);
}

// "Not Available" is Kindle's sentinel for a missing-but-known-absent value.
// Treat it identically to an empty cell.
function val(cell) {
  if (cell == null) return null;
  const s = cell.trim();
  if (!s || s === 'Not Available') return null;
  return s;
}

// Extract YYYY-MM-DD from an ISO 8601 timestamp (UTC). Returns null on
// unparseable input.
function isoToUtcDate(ts) {
  if (!ts) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ts);
  return m ? m[1] : null;
}

// ─── Aggregation ───────────────────────────────────────────────────────

let totalEvents = 0;
let droppedShort = 0;
let droppedNoDate = 0;
const groups = new Map();  // key: `${asin}|${date}` → { asin, date, ms }
const asinsSeen = new Set();

for (const r of allRows) {
  totalEvents++;
  const msRaw = val(r[I_MILLIS]);
  const ms = msRaw == null ? NaN : parseInt(msRaw, 10);
  if (!Number.isFinite(ms) || ms < minEventMs) { droppedShort++; continue; }
  const asin = val(r[I_ASIN]);
  if (!asin) { droppedNoDate++; continue; }
  asinsSeen.add(asin);
  const ts = val(r[I_END_TS]) || val(r[I_START_TS]);
  const date = isoToUtcDate(ts);
  if (!date) { droppedNoDate++; continue; }
  const key = `${asin}|${date}`;
  const g = groups.get(key) || { asin, date, ms: 0 };
  g.ms += ms;
  groups.set(key, g);
}

// ─── DB lookup ─────────────────────────────────────────────────────────

const { default: db } = await import('../db.js');

const bookByAsin = new Map();
for (const asin of asinsSeen) {
  const row = db.prepare('SELECT id, title FROM books WHERE asin = ? COLLATE NOCASE').get(asin);
  if (row) bookByAsin.set(asin, row);
}

// ─── Plan ──────────────────────────────────────────────────────────────

const writes = [];          // { book_id, date, minutes_read, title, asin }
const skipped = new Map();  // asin → { totalMinutes, days }

for (const g of groups.values()) {
  const minutes = Math.round(g.ms / 60000);
  if (minutes <= 0) continue;
  const book = bookByAsin.get(g.asin);
  if (book) {
    writes.push({ book_id: book.id, date: g.date, minutes_read: minutes, title: book.title, asin: g.asin });
  } else {
    const s = skipped.get(g.asin) || { totalMinutes: 0, days: 0 };
    s.totalMinutes += minutes;
    s.days += 1;
    skipped.set(g.asin, s);
  }
}

// ─── Summary ───────────────────────────────────────────────────────────

const dates = writes.map(w => w.date).sort();
const dateRange = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '(none)';
const totalMinutes = writes.reduce((s, w) => s + w.minutes_read, 0);
const matchedBooks = new Set(writes.map(w => w.book_id)).size;

console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'}  min-event-seconds=${minEventSeconds}\n`);
console.log(`Events read:        ${totalEvents}`);
console.log(`Dropped as short:   ${droppedShort}`);
console.log(`Dropped no date:    ${droppedNoDate}`);
console.log(`(asin, date) groups after filter: ${groups.size}`);
console.log(`Days to write:      ${writes.length}`);
console.log(`Books matched:      ${matchedBooks}`);
console.log(`Total minutes:      ${totalMinutes.toLocaleString()}  (${(totalMinutes / 60).toFixed(1)} hours)`);
console.log(`Date range:         ${dateRange}`);

if (skipped.size > 0) {
  console.log(`\nSkipped — no Spine book with matching ASIN (${skipped.size} unique titles):`);
  const rows = [...skipped.entries()].sort((a, b) => b[1].totalMinutes - a[1].totalMinutes);
  for (const [asin, s] of rows) {
    console.log(`  ${asin}  ${s.totalMinutes.toString().padStart(6)} min  ${s.days.toString().padStart(3)} days`);
  }
}

// ─── Apply ─────────────────────────────────────────────────────────────

if (!apply) {
  console.log(`\nDry-run only. Re-run with --apply to write ${writes.length} reading_log rows.`);
  process.exit(0);
}

const upsert = db.prepare(`
  INSERT INTO reading_log (book_id, date, pages_read, minutes_read)
  VALUES (?, ?, 0, ?)
  ON CONFLICT(book_id, date) WHERE story_id IS NULL DO UPDATE SET
    minutes_read = excluded.minutes_read
`);

const txn = db.transaction((rows) => {
  for (const w of rows) upsert.run(w.book_id, w.date, w.minutes_read);
});
txn(writes);

console.log(`\nWrote ${writes.length} reading_log rows.`);
