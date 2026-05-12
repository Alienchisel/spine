#!/usr/bin/env node
// Import Audible "Listening" CSV export into Spine's reading_log table.
//
// Usage:
//   node scripts/import-audible-listening.js <csv-path>            # dry-run
//   node scripts/import-audible-listening.js <csv-path> --apply    # write to DB
//   node scripts/import-audible-listening.js <csv-path> --min-event-seconds=60
//
// Each CSV row is a single listening session. We group by (ASIN, Start Date),
// sum Event Duration Milliseconds, convert to minutes, and upsert into the
// reading_log table — using Spine's existing ON CONFLICT(book_id, date)
// WHERE story_id IS NULL DO UPDATE semantics so re-running is idempotent.
// The WHERE clause is mandatory: reading_log's uniqueness is a partial
// index (book_id, date) WHERE story_id IS NULL, and SQLite refuses an
// ON CONFLICT target that omits the matching predicate.
//
// Filtering: events shorter than `--min-event-seconds` (default 60) are
// dropped before grouping. This excludes the accidental taps and brief
// app-foregrounding events that Audible records.

import fs from 'fs';
import path from 'path';

// ─── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const minEventSecondsArg = args.find(a => a.startsWith('--min-event-seconds='));
const minEventSeconds = minEventSecondsArg ? parseInt(minEventSecondsArg.split('=')[1], 10) : 60;
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/import-audible-listening.js <csv-path> [--apply] [--min-event-seconds=N]');
  process.exit(1);
}
if (!Number.isFinite(minEventSeconds) || minEventSeconds < 0) {
  console.error('Invalid --min-event-seconds');
  process.exit(1);
}
const minEventMs = minEventSeconds * 1000;

// ─── CSV parsing ───────────────────────────────────────────────────────

// Audible's CSV is RFC-4180-ish: comma-separated, fields quoted with " and
// embedded quotes doubled. No newlines inside fields in this export, but
// we handle them anyway for robustness.
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
const idx = (name) => header.indexOf(name);

const I_START_DATE   = idx('Start Date');
const I_DURATION_MS  = idx('Event Duration Milliseconds');
const I_PRODUCT_NAME = idx('Product Name');
const I_ASIN         = idx('ASIN');

if ([I_START_DATE, I_DURATION_MS, I_PRODUCT_NAME, I_ASIN].some(v => v < 0)) {
  console.error('CSV missing required columns (Start Date, Event Duration Milliseconds, Product Name, ASIN)');
  process.exit(1);
}

// ─── Aggregation ───────────────────────────────────────────────────────

let totalEvents = 0;
let droppedShort = 0;
const groups = new Map();         // key: `${asin}|${date}` → { asin, date, ms, productName }
const productByAsin = new Map();  // asin → product name (most recent wins)

for (const r of allRows) {
  totalEvents++;
  const ms = parseInt(r[I_DURATION_MS], 10);
  if (!Number.isFinite(ms) || ms < minEventMs) { droppedShort++; continue; }
  const asin = r[I_ASIN];
  const date = r[I_START_DATE];
  const product = r[I_PRODUCT_NAME];
  if (!asin || !date) { droppedShort++; continue; }
  productByAsin.set(asin, product);
  const key = `${asin}|${date}`;
  const g = groups.get(key) || { asin, date, ms: 0, productName: product };
  g.ms += ms;
  groups.set(key, g);
}

// ─── DB lookup ─────────────────────────────────────────────────────────

const { default: db } = await import('../db.js');

const bookByAsin = new Map();
for (const asin of productByAsin.keys()) {
  const row = db.prepare('SELECT id, title FROM books WHERE asin = ? COLLATE NOCASE').get(asin);
  if (row) bookByAsin.set(asin, row);
}

// ─── Plan ──────────────────────────────────────────────────────────────

const writes = [];          // { book_id, date, minutes_read, title, asin }
const skipped = new Map();  // asin → { product, totalMinutes, days }

for (const g of groups.values()) {
  const minutes = Math.round(g.ms / 60000);
  if (minutes <= 0) continue;
  const book = bookByAsin.get(g.asin);
  if (book) {
    writes.push({ book_id: book.id, date: g.date, minutes_read: minutes, title: book.title, asin: g.asin });
  } else {
    const s = skipped.get(g.asin) || { product: g.productName, totalMinutes: 0, days: 0 };
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
console.log(`(asin, date) groups after filter: ${groups.size}`);
console.log(`Days to write:      ${writes.length}`);
console.log(`Books matched:      ${matchedBooks}`);
console.log(`Total minutes:      ${totalMinutes.toLocaleString()}  (${(totalMinutes / 60).toFixed(1)} hours)`);
console.log(`Date range:         ${dateRange}`);

if (skipped.size > 0) {
  console.log(`\nSkipped — no Spine book with matching ASIN (${skipped.size} unique audiobooks):`);
  const rows = [...skipped.entries()].sort((a, b) => b[1].totalMinutes - a[1].totalMinutes);
  for (const [asin, s] of rows) {
    console.log(`  ${asin}  ${s.totalMinutes.toString().padStart(6)} min  ${s.days.toString().padStart(3)} days  ${s.product}`);
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
