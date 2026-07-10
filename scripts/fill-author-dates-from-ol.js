// One-off: walk every Spine author missing birth_date OR death_date,
// look them up on Open Library, and PATCH back whichever of the two
// dates is unquestionable. "Unquestionable" here means we confirm
// author *identity*, not just name — a match on name alone would
// happily attach Joseph Goodman (b. 1918) to the modern RPG publisher.
//
//   1. OL's top-8 search hits must contain at least one entry whose
//      display name is an EXACT case-insensitive match for the Spine
//      author.
//   2. That candidate's `top_work` must match (case-insensitive,
//      leading-article normalised) one of the book titles Spine has
//      byline-linked to this author. This is the identity check —
//      if OL's top-ranked work for this candidate is one of ours,
//      it's the same person.
//   3. We only touch fields that are currently NULL. birth_date/
//      death_date already filled are left alone (COALESCE-style).
//   4. Bio, photo, and ol_key are never written — the user picks
//      photos manually and keeps bio curation under the /:id/refresh
//      flow.
//
// Run with `--apply` to write; without it, prints a dry-run plan.
// Polite 800ms delay between OL requests.
//
// Uses lib/authors/openLibrary.js helpers so the date-parsing quirks
// (BCE years, "July 18, 1938", "1938-07-18", etc.) stay consistent
// with the existing refresh path.

import db from '../db.js';
import { searchAuthorsMulti, fetchAuthorDetails } from '../lib/authors/openLibrary.js';

// Title normaliser for the identity cross-reference. Strips a leading
// article (dup-sweep convention), and lops off a subtitle after ": "
// or " - " so "Whole Earth Discipline" and OL's "Whole earth
// discipline: an ecopragmatist manifesto" collide. Lowercases and
// collapses whitespace.
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[:\-–—]\s.*$/, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const PORT = process.env.PORT || 3001;
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const flag = process.argv.find(a => a.startsWith('--limit='));
  return flag ? Number(flag.slice('--limit='.length)) : Infinity;
})();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickExactMatches(candidates, name) {
  const target = name.toLowerCase();
  return candidates.filter(c => (c.name || '').toLowerCase() === target);
}

const rows = db.prepare(`
  SELECT id, name, birth_date, death_date, ol_key
  FROM authors
  WHERE (birth_date IS NULL OR birth_date = '' OR death_date IS NULL OR death_date = '')
    AND (ol_key IS NULL OR ol_key = '')
  ORDER BY id
`).all();

// Pre-compute the set of Spine book titles per author (normalised) so
// the OL top_work cross-reference is a cheap Set lookup.
const titlesByAuthor = new Map();
{
  const all = db.prepare(`
    SELECT ba.author_id, b.title
    FROM book_authors ba
    JOIN books b ON b.id = ba.book_id
    WHERE b.archived = 0
  `).all();
  for (const { author_id, title } of all) {
    const norm = normTitle(title);
    if (!norm) continue;
    if (!titlesByAuthor.has(author_id)) titlesByAuthor.set(author_id, new Set());
    titlesByAuthor.get(author_id).add(norm);
  }
}

console.log(`${rows.length} authors missing at least one date (no prior OL fetch)`);
console.log(APPLY ? 'Mode: APPLY (writing changes)' : 'Mode: dry-run (re-run with --apply to write)');
if (Number.isFinite(LIMIT)) console.log(`Limit: first ${LIMIT}`);
console.log('');

let updated = 0, skippedNoMatch = 0, skippedNoTitleXref = 0, skippedNoData = 0, failed = 0;
let processed = 0;

for (const author of rows) {
  if (processed >= LIMIT) break;
  processed++;
  try {
    const candidates = await searchAuthorsMulti(author.name, 8);
    const exact = pickExactMatches(candidates, author.name);
    if (exact.length === 0) {
      console.log(`  -- ${author.name}  (no exact-name match on OL)`);
      skippedNoMatch++;
      await sleep(800);
      continue;
    }
    // Identity check: OL exact-name matches with the wrong person are
    // common for common names. Require the candidate's `top_work` to
    // match a Spine book title we've byline-linked to this author.
    const spineTitles = titlesByAuthor.get(author.id) || new Set();
    const confirmed = exact.filter(c => c.top_work && spineTitles.has(normTitle(c.top_work)));
    if (confirmed.length === 0) {
      const olTops = exact.map(e => e.top_work).filter(Boolean).slice(0, 2).join(' | ') || '—';
      console.log(`  ?? ${author.name}  (${exact.length} exact-name matches, no top_work overlap; OL tops: ${olTops})`);
      skippedNoTitleXref++;
      await sleep(800);
      continue;
    }
    // Prefer the confirmed candidate with the fullest date pair.
    const pick = confirmed.find(e => e.birth_date && e.death_date)
              || confirmed.find(e => e.birth_date)
              || confirmed[0];
    // Fetch the detail record — dates on the search endpoint are
    // sometimes stringy ("15 April 1930") vs the /authors/OLxxA.json
    // canonical shape. openLibrary.parseDate normalises both.
    const details = await fetchAuthorDetails(pick.ol_key);
    const body = {};
    if (!author.birth_date && details.birth_date) body.birth_date = details.birth_date;
    if (!author.death_date && details.death_date) {
      // Guard against OL vandalism / unverified recent deaths: a
      // bare-year death_date within the last 3 years is exactly the
      // shape "someone edited '2026' with no source" takes. Dan
      // Simmons's OL record returned death_date '2026' during the
      // 2026-07-09 dry run despite being alive; skip and let the
      // user apply it manually if it's real.
      const y = details.death_date.match(/^(\d{4})$/);
      const currentYear = new Date().getFullYear();
      if (y && currentYear - Number(y[1]) < 3) {
        console.log(`  ?? ${author.name}  (OL ${pick.ol_key}) death_date='${details.death_date}' looks unverified — skipping`);
        skippedNoData++;
        await sleep(800);
        continue;
      }
      body.death_date = details.death_date;
    }
    if (!body.birth_date && !body.death_date) {
      console.log(`  -- ${author.name}  (OL match ${pick.ol_key} has no new dates)`);
      skippedNoData++;
      await sleep(800);
      continue;
    }
    const tag = [
      body.birth_date ? `b=${body.birth_date}` : null,
      body.death_date ? `d=${body.death_date}` : null,
    ].filter(Boolean).join(' ');
    if (APPLY) {
      const res = await fetch(`http://localhost:${PORT}/api/authors/${author.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.log(`  !! ${author.name}  HTTP ${res.status} ${detail.slice(0, 120)}`);
        failed++;
      } else {
        console.log(`  ok ${author.name}  (${pick.ol_key}) ${tag}`);
        updated++;
      }
    } else {
      console.log(`  +  ${author.name}  (${pick.ol_key}) ${tag}`);
      updated++;
    }
    await sleep(800);
  } catch (e) {
    console.log(`  !! ${author.name}  ${e.message}`);
    failed++;
    await sleep(800);
  }
}

console.log('');
console.log(`Summary: ${updated} ${APPLY ? 'updated' : 'would update'}, ${skippedNoMatch} no-name-match, ${skippedNoTitleXref} no-title-xref, ${skippedNoData} no-new-data, ${failed} failed. (${processed} processed)`);
