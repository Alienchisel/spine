// One-shot: walk every non-audiobook book with a NULL page_count AND
// at least one ISBN on record, look the ISBN up on Open Library, and
// PATCH page_count from the returned number_of_pages. ISBN identity is
// unambiguous — no title/author cross-reference needed.
//
// Used to hit Google Books v1 (`?q=isbn:...`) but the anonymous quota
// there is aggressive-per-IP now (~10 requests before a 429), and we
// don't want to add an API key just for a one-off backfill. Open
// Library has no key requirement and we already talk to it for author
// bios and cover fallback. 800ms polite delay between requests.
//
// Ebook edition ISBNs sometimes report a different number_of_pages
// than the print equivalent (some ebook records carry the print run's
// count, others carry an "estimated" number). Since these are books
// the user's own record already flagged as non-audiobook, taking
// whatever OL returns is the closest fit we can get without human
// review. Values obviously wrong (<10 or >5000) are skipped and
// logged for manual inspection.
//
// Run:  ./scripts/with-toolchain.sh node scripts/fill-page-count-from-google-books.js
//   --apply       write the PATCHes (default: dry-run)
//   --limit=N     process only the first N candidates
//
// Safe by construction: the underlying PATCH is field-scoped (only
// page_count is sent) and the fetch is read-only against Open Library.

import db from '../db.js';

const PORT   = process.env.PORT || 3001;
const APPLY  = process.argv.includes('--apply');
const LIMIT  = (() => {
  const flag = process.argv.find(a => a.startsWith('--limit='));
  return flag ? Number(flag.slice('--limit='.length)) : Infinity;
})();

const UA    = 'Spine/1.0 (personal library tracker; +https://github.com/Alienchisel/spine)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MIN_PAGES = 10;
// Delphi Complete Works ebooks (Kant, Nietzsche, Dostoevsky, etc.) run
// 5-10k pages legitimately, so the upper bound stays permissive; the
// gate is really "reject obviously broken data" (0-page phantom ebook
// records, 100k+ metadata bugs), not "cap at any specific length".
const MAX_PAGES = 15000;

async function fetchPageCount(isbn) {
  // OL's /isbn/{n}.json redirects to /books/OL{k}M.json; fetch honours
  // redirects by default. 404 = OL doesn't know this ISBN.
  const url = `https://openlibrary.org/isbn/${isbn}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OL ${res.status}`);
  const data = await res.json();
  const pages = data?.number_of_pages;
  return Number.isInteger(pages) && pages > 0 ? pages : null;
}

const rows = db.prepare(`
  SELECT id, title, format, isbn_13, isbn_10
  FROM books
  WHERE archived = 0
    AND format != 'audiobook'
    AND page_count IS NULL
    AND (isbn_13 IS NOT NULL OR isbn_10 IS NOT NULL)
  ORDER BY id
`).all();

console.log(`${rows.length} book(s) missing page_count with an ISBN on record`);
console.log(APPLY ? 'Mode: APPLY (writing PATCHes)' : 'Mode: dry-run (re-run with --apply to write)');
if (Number.isFinite(LIMIT)) console.log(`Limit: first ${LIMIT}`);
console.log('');

let updated = 0, notFound = 0, outOfRange = 0, failed = 0;
let processed = 0;

for (const row of rows) {
  if (processed >= LIMIT) break;
  processed++;
  const isbn = row.isbn_13 || row.isbn_10;
  try {
    const pages = await fetchPageCount(isbn);
    if (pages == null) {
      console.log(`  -- #${row.id} ${row.title.slice(0, 45).padEnd(45)} isbn=${isbn}  (OL has no number_of_pages)`);
      notFound++;
      await sleep(800);
      continue;
    }
    if (pages < MIN_PAGES || pages > MAX_PAGES) {
      console.log(`  ?? #${row.id} ${row.title.slice(0, 45).padEnd(45)} isbn=${isbn}  pages=${pages} out of range, skipping`);
      outOfRange++;
      await sleep(800);
      continue;
    }
    if (APPLY) {
      const res = await fetch(`http://localhost:${PORT}/api/books/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_count: pages }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.log(`  !! #${row.id} ${row.title.slice(0, 45)}  HTTP ${res.status} ${detail.slice(0, 120)}`);
        failed++;
      } else {
        console.log(`  ok #${row.id} ${row.title.slice(0, 45).padEnd(45)} pages=${pages}`);
        updated++;
      }
    } else {
      console.log(`  +  #${row.id} ${row.title.slice(0, 45).padEnd(45)} pages=${pages}`);
      updated++;
    }
    await sleep(800);
  } catch (e) {
    console.log(`  !! #${row.id} ${row.title.slice(0, 45)}  ${e.message}`);
    failed++;
    await sleep(800);
  }
}

console.log('');
console.log(`Summary: ${updated} ${APPLY ? 'updated' : 'would update'}, ${notFound} no-page-count-returned, ${outOfRange} out-of-range, ${failed} failed. (${processed} processed)`);
