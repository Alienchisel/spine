#!/usr/bin/env node
// Import Kindle "Reading Session" CSV export into Spine's reading_log table.
//
// Usage:
//   node scripts/import-kindle-reading-sessions.js <csv-path>                 # dry-run, all matched books
//   node scripts/import-kindle-reading-sessions.js <csv-path> --apply
//   node scripts/import-kindle-reading-sessions.js <csv-path> --asin=B075MRHZBV[,B0XXXXXXXX]
//   node scripts/import-kindle-reading-sessions.js <csv-path> --book-id=644[,645]
//   node scripts/import-kindle-reading-sessions.js <csv-path> --min-event-seconds=60
//   node scripts/import-kindle-reading-sessions.js <csv-path> --include-page-flips
//
// Each CSV row is a single Kindle reading session. We group by (ASIN, date),
// sum total_reading_millis (→ minutes_read), and upsert into reading_log —
// using the same ON CONFLICT(book_id, date) WHERE story_id IS NULL shape as
// the Audible importer, so re-running is idempotent.
//
// Date derivation: prefer end_timestamp, fall back to start_timestamp. Both
// can be literal "Not Available" in this export; rows with neither are
// dropped. Timestamps are ISO 8601 in UTC (Z suffix); we extract the UTC
// date. If you want local-date semantics, convert the CSV upstream.
//
// Filtering: sessions shorter than `--min-event-seconds` (default 60) are
// dropped before grouping — excludes accidental opens and brief app
// foregrounding the Kindle device records.
//
// Scope filters: --asin and --book-id (each comma-separated) narrow the
// apply set. Default scope is every matched ASIN in the CSV. Use the
// filters for surgical backfills; the Kindle export covers years and the
// importer replaces minutes_read on conflict, so a blind --apply over
// active books will overwrite live diary state for any overlapping
// (book, date).
//
// Pages signal (default off): minutes is the truthful per-day signal —
// every recorded session was real engagement. Pages, however, would have
// to come from number_of_page_flips, which counts every page navigation
// (including back-flips and lookups). Its sum across days routinely
// overshoots the book's actual forward progress AND drags down
// avgPagesPerDay (the projection rate used to estimate days-left on
// active reads). The default is minutes-only: pages_read is set to 0
// on INSERT and preserved on conflict. Pass --include-page-flips to opt
// into writing page_flips as pages_read; that mode also replaces
// pages_read on conflict.

import fs from 'fs';

// ─── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includePageFlips = args.includes('--include-page-flips');
const minEventSecondsArg = args.find(a => a.startsWith('--min-event-seconds='));
const minEventSeconds = minEventSecondsArg ? parseInt(minEventSecondsArg.split('=')[1], 10) : 60;
const asinFilterArg = args.find(a => a.startsWith('--asin='));
const bookIdFilterArg = args.find(a => a.startsWith('--book-id='));
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/import-kindle-reading-sessions.js <csv-path> [--apply] [--asin=A,B] [--book-id=N,M] [--min-event-seconds=N] [--include-page-flips]');
  process.exit(1);
}
if (!Number.isFinite(minEventSeconds) || minEventSeconds < 0) {
  console.error('Invalid --min-event-seconds');
  process.exit(1);
}
const minEventMs = minEventSeconds * 1000;

const parseList = (arg) => arg ? new Set(arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean)) : null;
const asinFilter   = parseList(asinFilterArg);                                  // Set<string> | null
const bookIdRaw    = parseList(bookIdFilterArg);
const bookIdFilter = bookIdRaw ? new Set([...bookIdRaw].map(n => Number(n))) : null;  // Set<number> | null
if (bookIdFilter && [...bookIdFilter].some(n => !Number.isInteger(n) || n < 1)) {
  console.error('Invalid --book-id (expected positive integers, comma-separated)');
  process.exit(1);
}
const hasScopeFilter = !!(asinFilter || bookIdFilter);

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
const I_FLIPS     = idx('number_of_page_flips');

if ([I_START_TS, I_END_TS, I_ASIN, I_MILLIS, I_FLIPS].some(v => v < 0)) {
  console.error('CSV missing required columns (start_timestamp, end_timestamp, ASIN, total_reading_millis, number_of_page_flips)');
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
const groups = new Map();  // key: `${asin}|${date}` → { asin, date, ms, flips }
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
  // page_flips can be missing on rows where Kindle recorded reading time
  // but no navigation events — fall back to 0 rather than skipping the row.
  const flipsRaw = val(r[I_FLIPS]);
  const flips = flipsRaw == null ? 0 : (parseInt(flipsRaw, 10) || 0);
  const key = `${asin}|${date}`;
  const g = groups.get(key) || { asin, date, ms: 0, flips: 0 };
  g.ms += ms;
  g.flips += flips;
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

const writes = [];          // { book_id, date, minutes_read, pages_read, title, asin }
const skipped = new Map();  // asin → { totalMinutes, days }
const filteredOut = new Map(); // book_id → { title, asin, days, minutes } — matched but excluded by --asin/--book-id

for (const g of groups.values()) {
  const minutes = Math.round(g.ms / 60000);
  if (minutes <= 0) continue;
  const book = bookByAsin.get(g.asin);
  if (!book) {
    const s = skipped.get(g.asin) || { totalMinutes: 0, days: 0 };
    s.totalMinutes += minutes;
    s.days += 1;
    skipped.set(g.asin, s);
    continue;
  }
  const inScope = (!asinFilter   || asinFilter.has(g.asin))
              && (!bookIdFilter || bookIdFilter.has(book.id));
  if (!inScope) {
    const f = filteredOut.get(book.id) || { title: book.title, asin: g.asin, days: 0, minutes: 0 };
    f.days += 1;
    f.minutes += minutes;
    filteredOut.set(book.id, f);
    continue;
  }
  writes.push({
    book_id:      book.id,
    date:         g.date,
    minutes_read: minutes,
    // Default minutes-only: pages_read stays 0 (and is preserved on
    // conflict so any existing live progress isn't clobbered). The
    // --include-page-flips flag opts into writing & replacing pages_read.
    pages_read:   includePageFlips ? g.flips : 0,
    title:        book.title,
    asin:         g.asin,
  });
}

// ─── Summary ───────────────────────────────────────────────────────────

const dates = writes.map(w => w.date).sort();
const dateRange = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '(none)';
const totalMinutes = writes.reduce((s, w) => s + w.minutes_read, 0);
const totalPages   = writes.reduce((s, w) => s + w.pages_read,   0);
const matchedBooks = new Set(writes.map(w => w.book_id)).size;

console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'}  min-event-seconds=${minEventSeconds}  pages=${includePageFlips ? 'page_flips' : 'off (minutes-only)'}`);
if (asinFilter)   console.log(`Scope: --asin=${[...asinFilter].join(',')}`);
if (bookIdFilter) console.log(`Scope: --book-id=${[...bookIdFilter].join(',')}`);
console.log('');
console.log(`Events read:        ${totalEvents}`);
console.log(`Dropped as short:   ${droppedShort}`);
console.log(`Dropped no date:    ${droppedNoDate}`);
console.log(`(asin, date) groups after filter: ${groups.size}`);
console.log(`Days to write:      ${writes.length}`);
console.log(`Books matched:      ${matchedBooks}`);
console.log(`Total minutes:      ${totalMinutes.toLocaleString()}  (${(totalMinutes / 60).toFixed(1)} hours)`);
console.log(`Total pages:        ${totalPages.toLocaleString()}`);
console.log(`Date range:         ${dateRange}`);

if (hasScopeFilter && writes.length) {
  console.log(`\nIn-scope target books (will be written):`);
  const perBook = new Map();
  for (const w of writes) {
    const b = perBook.get(w.book_id) || { title: w.title, asin: w.asin, days: 0, minutes: 0, pages: 0 };
    b.days    += 1;
    b.minutes += w.minutes_read;
    b.pages   += w.pages_read;
    perBook.set(w.book_id, b);
  }
  for (const [id, b] of [...perBook.entries()].sort((a, c) => c[1].minutes - a[1].minutes)) {
    console.log(`  #${id}  ${b.minutes.toString().padStart(6)} min  ${b.pages.toString().padStart(5)} pages  ${b.days.toString().padStart(3)} days  ${b.asin}  ${b.title}`);
  }
}

// Only surface the noisy lists when no scope filter is in play. Once the
// user is narrowing to specific books, the off-target ASINs are not what
// they're trying to decide on.
if (!hasScopeFilter && skipped.size > 0) {
  console.log(`\nSkipped — no Spine book with matching ASIN (${skipped.size} unique titles):`);
  const rows = [...skipped.entries()].sort((a, b) => b[1].totalMinutes - a[1].totalMinutes);
  for (const [asin, s] of rows) {
    console.log(`  ${asin}  ${s.totalMinutes.toString().padStart(6)} min  ${s.days.toString().padStart(3)} days`);
  }
}

if (hasScopeFilter && filteredOut.size > 0) {
  console.log(`\nMatched books filtered out by scope (${filteredOut.size}):`);
  const rows = [...filteredOut.entries()].sort((a, b) => b[1].minutes - a[1].minutes);
  for (const [id, f] of rows) {
    console.log(`  #${id}  ${f.minutes.toString().padStart(6)} min  ${f.days.toString().padStart(3)} days  ${f.asin}  ${f.title}`);
  }
}

// ─── Apply ─────────────────────────────────────────────────────────────

if (!apply) {
  console.log(`\nDry-run only. Re-run with --apply to write ${writes.length} reading_log rows.`);
  process.exit(0);
}

// Default (minutes-only): preserve any existing pages_read on conflict —
// the user may have set it intentionally elsewhere (live progress patches,
// a prior --include-page-flips run, hand edits). We're only authoritative
// on minutes here.
// --include-page-flips: replace both columns, since the user has opted to
// trust the page_flips signal end-to-end.
const upsert = db.prepare(includePageFlips ? `
  INSERT INTO reading_log (book_id, date, pages_read, minutes_read)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(book_id, date) WHERE story_id IS NULL DO UPDATE SET
    pages_read   = excluded.pages_read,
    minutes_read = excluded.minutes_read
` : `
  INSERT INTO reading_log (book_id, date, pages_read, minutes_read)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(book_id, date) WHERE story_id IS NULL DO UPDATE SET
    minutes_read = excluded.minutes_read
`);

const txn = db.transaction((rows) => {
  for (const w of rows) upsert.run(w.book_id, w.date, w.pages_read, w.minutes_read);
});
txn(writes);

console.log(`\nWrote ${writes.length} reading_log rows.`);
