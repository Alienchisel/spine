#!/usr/bin/env node
// Match the Audible Listening CSV's (ASIN, Product Name) pairs against
// audiobooks in Spine that have no ASIN, and propose patches that fill
// the missing ASIN by title match.
//
// Usage:
//   node scripts/repair-asins-from-listening.js <csv-path>            # dry-run
//   node scripts/repair-asins-from-listening.js <csv-path> --apply
//
// Match strategy: normalize titles (lowercase, strip "(Unabridged…)"
// suffixes, strip leading article) and compare for equality. Only patches
// when exactly ONE Spine audiobook with `asin IS NULL` normalizes to the
// CSV's normalized product name. Mismatches and ambiguities are reported.
//
// This script never overwrites an existing ASIN under --apply. Books
// whose ASIN already differs from the CSV are collected into a REPLACE
// report for manual review, but are NOT auto-patched: a correct ASIN
// could otherwise be clobbered when a different Audible edition/region
// of the same title normalizes to the same string (ASINs drive the
// listening/diary imports and cover fetches, so a wrong one is costly).
// Apply the genuine replacements by hand after eyeballing the report.

import fs from 'fs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/repair-asins-from-listening.js <csv-path> [--apply]');
  process.exit(1);
}

// ─── CSV parsing (same shape as import-audible-listening.js) ──────────

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
const I_PRODUCT_NAME = header.indexOf('Product Name');
const I_ASIN         = header.indexOf('ASIN');
const I_DURATION_MS  = header.indexOf('Event Duration Milliseconds');

// Unique (ASIN → { product, totalMs }) — track total listening time so we
// can break ties when multiple CSV ASINs map to the same Spine book.
const csvByAsin = new Map();
for (const r of allRows) {
  const asin = r[I_ASIN];
  const product = r[I_PRODUCT_NAME];
  if (!asin || !product) continue;
  const dur = parseInt(r[I_DURATION_MS], 10) || 0;
  const existing = csvByAsin.get(asin);
  if (existing) { existing.totalMs += dur; }
  else          { csvByAsin.set(asin, { product, totalMs: dur }); }
}

// ─── Title normalization ─────────────────────────────────────────────

// Aggressive title normalization for matching CSV product names (which
// carry Audible's franchise / edition / book-number suffixes) against
// user-curated Spine titles (which usually don't).
//
// Steps, all case-insensitive on the lowercased string:
//   1. Strip every parenthetical / bracketed annotation:
//      (Unabridged), (Dramatized), (Full-Cast Edition), [Vol. 1], etc.
//   2. Strip trademark / registered glyphs and their textual equivalents
//      so `Freedom™` matches `Freedom (TM)`.
//   3. Iteratively strip trailing colon-suffixes that look like franchise
//      or series metadata: `: Warhammer …`, `: …, Book N`, `: A Novel`,
//      `: The X Chronicles`. Looped because some titles have stacked
//      suffixes (`Guns of Tanith: Warhammer 40,000: Gaunt's Ghosts, Book 5`).
//   4. Strip leading "The/A/An".
//   5. Collapse whitespace.
function normalizeTitle(t) {
  let s = (t || '').toLowerCase();
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = s.replace(/\s*\[[^\]]*\]\s*/g, ' ');
  s = s.replace(/[™®]/g, '');
  s = s.replace(/\s*\(tm\)|\s*\(r\)/g, '');
  let prev;
  do {
    prev = s;
    s = s.replace(/\s*:\s*warhammer\b[^:]*$/i, '');
    s = s.replace(/\s*:\s*[^:]*\bbook\s+\w+\s*$/i, '');
    s = s.replace(/\s*:\s*[^:]*\bvol(?:\.|ume)?\s+\w+\s*$/i, '');
    s = s.replace(/\s*:\s*(a\s+novel|the\s+novel)\s*$/i, '');
    s = s.replace(/\s*:\s*the\s+[a-z]+\s+chronicles\s*$/i, '');
    s = s.replace(/\s*:\s*gaunt'?s\s+ghosts?\b[^:]*$/i, '');
  } while (s !== prev);
  s = s.replace(/^\s*(the|a|an)\s+/i, '');
  return s.replace(/\s+/g, ' ').trim();
}

// ─── DB lookup ────────────────────────────────────────────────────────

const { default: db } = await import('../db.js');

const allAudiobooks = db.prepare(
  "SELECT id, title, asin FROM books WHERE format = 'audiobook'"
).all();

// Build a map: normalized title → list of Spine books with that title.
// Includes books that already have an ASIN — we want to surface those as
// REPLACE candidates when their existing ASIN differs from the CSV's.
const spineByNorm = new Map();
for (const b of allAudiobooks) {
  const k = normalizeTitle(b.title);
  if (!k) continue;
  if (!spineByNorm.has(k)) spineByNorm.set(k, []);
  spineByNorm.get(k).push(b);
}

// ─── Match ─────────────────────────────────────────────────────────────

const fills    = [];   // Spine had no ASIN; CSV provides one.
const replaces = [];   // Spine had a different ASIN; CSV is authoritative.
const matches  = [];   // Spine already has this exact ASIN — skip.
const ambiguous = [];  // Multiple Spine candidates with the same normalized title.
const noMatch   = [];  // No Spine audiobook with this title.

// Prefix-fallback: when CSV's normalized title doesn't equal any Spine
// normalized title exactly, look for a Spine title that's the CSV's
// title + ': <subtitle>' (Spine has more) OR the CSV's title is the
// Spine title + ': <subtitle>' (CSV has more — should be rare after the
// new normalizer but possible). Requires exactly one match; otherwise
// skip to ambiguous.
function findPrefixMatches(csvNorm) {
  const out = [];
  for (const [spineNorm, books] of spineByNorm.entries()) {
    if (spineNorm.startsWith(csvNorm + ': ') || csvNorm.startsWith(spineNorm + ': ')) {
      out.push(...books);
    }
  }
  return out;
}

// First pass: bucket CSV ASINs per Spine book id, by normalized title
// (exact, then prefix-fallback).
const candidatesByBookId = new Map(); // bookId → [{ asin, productName, totalMs }]
for (const [asin, info] of csvByAsin.entries()) {
  const norm = normalizeTitle(info.product);
  if (!norm) { noMatch.push({ asin, productName: info.product, norm }); continue; }
  let cs = spineByNorm.get(norm);
  if (!cs) {
    const prefix = findPrefixMatches(norm);
    if (prefix.length > 0) cs = prefix;
  }
  if (!cs) { noMatch.push({ asin, productName: info.product, norm }); continue; }
  if (cs.length > 1) { ambiguous.push({ asin, productName: info.product, candidates: cs }); continue; }
  const id = cs[0].id;
  if (!candidatesByBookId.has(id)) candidatesByBookId.set(id, []);
  candidatesByBookId.get(id).push({ asin, productName: info.product, totalMs: info.totalMs });
}

// Second pass: for each Spine book, pick the CSV ASIN with the most
// total listening time; classify the survivor as fill/replace/match.
const dropped = [];   // { keptAsin, droppedAsin, totalMs, title } — for transparency
for (const [id, candidates] of candidatesByBookId.entries()) {
  const sorted = [...candidates].sort((a, b) => b.totalMs - a.totalMs);
  const winner = sorted[0];
  const losers = sorted.slice(1);

  const book = allAudiobooks.find(b => b.id === id);
  for (const loser of losers) {
    dropped.push({ id, title: book.title, keptAsin: winner.asin, droppedAsin: loser.asin, totalMs: loser.totalMs });
  }

  if (!book.asin)                  fills.push({ id, title: book.title, asin: winner.asin, productName: winner.productName });
  else if (book.asin === winner.asin) matches.push({ id, title: book.title, asin: winner.asin });
  else                             replaces.push({ id, title: book.title, oldAsin: book.asin, newAsin: winner.asin, productName: winner.productName });
}

// Only fills are auto-applied. `replaces` (differing existing ASIN) are
// report-only — surfaced for manual review, never written — so a correct
// ASIN can't be overwritten on a fuzzy title match. See header note.
const patches = [...fills];

// ─── Report ────────────────────────────────────────────────────────────

console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'}\n`);
console.log(`Audiobooks in Spine:                ${allAudiobooks.length}`);
console.log(`Unique ASINs in CSV:                ${csvByAsin.size}`);
console.log(`Already correct (CSV ASIN matches): ${matches.length}`);
console.log(`Fill (Spine had no ASIN):           ${fills.length}`);
console.log(`Replace (Spine ASIN differs — REVIEW ONLY, not auto-applied): ${replaces.length}`);
console.log(`Ambiguous (multiple Spine matches): ${ambiguous.length}`);
console.log(`No Spine match for CSV title:       ${noMatch.length}`);

if (fills.length > 0) {
  console.log(`\nFills:`);
  for (const p of fills) {
    console.log(`  id=${String(p.id).padStart(4)}  asin=${p.asin}  ${p.title}`);
  }
}

if (replaces.length > 0) {
  console.log(`\nReplaces (Spine ASIN → CSV ASIN) — REVIEW ONLY, not written by --apply.`);
  console.log(`Patch by hand any that are genuinely wrong in Spine:`);
  for (const p of replaces) {
    console.log(`  id=${String(p.id).padStart(4)}  ${p.oldAsin} → ${p.newAsin}  ${p.title}`);
  }
}

if (ambiguous.length > 0) {
  console.log(`\nAmbiguous (multiple Spine audiobooks normalize to the same CSV title — review manually):`);
  for (const a of ambiguous) {
    console.log(`  csv=${a.asin}  "${a.productName}"`);
    for (const c of a.candidates) console.log(`     └─ id=${c.id}  asin=${c.asin || 'NULL'}  ${c.title}`);
  }
}

if (dropped.length > 0) {
  console.log(`\nMultiple CSV ASINs mapped to one Spine book — kept the most-listened-to, dropped the rest:`);
  for (const d of dropped) {
    const mins = Math.round(d.totalMs / 60000);
    console.log(`  id=${String(d.id).padStart(4)}  kept=${d.keptAsin}  dropped=${d.droppedAsin}  (${mins} min)  ${d.title}`);
  }
}

if (noMatch.length > 0 && !apply) {
  console.log(`\nNo Spine match (${noMatch.length}) — books listened to but not in Spine. Sample:`);
  for (const n of noMatch.slice(0, 10)) {
    console.log(`  csv=${n.asin}  "${n.productName}"`);
  }
  if (noMatch.length > 10) console.log(`  … (${noMatch.length - 10} more)`);
}

// ─── Apply ────────────────────────────────────────────────────────────

if (!apply) {
  console.log(`\nDry-run only. Re-run with --apply to patch ${patches.length} ASINs (${fills.length} fills; ${replaces.length} replaces are review-only and won't be written).`);
  process.exit(0);
}

const upd = db.prepare("UPDATE books SET asin = ?, updated_at = datetime('now', 'localtime') WHERE id = ?");
const txn = db.transaction((rows) => { for (const p of rows) upd.run(p.asin, p.id); });
txn(patches);

console.log(`\nPatched ${patches.length} ASINs (${fills.length} fills). ${replaces.length} replaces left for manual review.`);
