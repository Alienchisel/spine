// One-off: walk every Spine author with a Science Fiction byline and no
// birth_date set, look them up on ISFDB, parse Birthdate / Deathdate,
// and PATCH back into Spine. The /api/authors PATCH is the existing
// non-destructive merge — anything already populated stays put. ISFDB
// returns date shapes like "2 January 1920" / "January 1920" / "1920"
// / "0000-00-00" (== unknown), all normalised to YYYY[-MM[-DD]].
//
// Match strategy: ISFDB's Name search returns multiple rows including
// translations and pseudonyms. We pick the first row whose displayed
// name is an exact case-insensitive match for the Spine author name —
// avoids accidentally landing on a Russian-script variant or a
// "...(in error)" duplicate. If no exact match, skip.
//
// Run with `--apply` to write; without it, prints a dry-run plan.
// Polite 800ms delay between requests.

import db from '../db.js';

const UA = 'Mozilla/5.0 (Spine/1.0 personal library tracker; charlesss@gmail.com)';
const PORT = process.env.PORT || 3001;
const APPLY = process.argv.includes('--apply');

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

function parseIsfdbDate(s) {
  if (!s) return null;
  const str = s.trim();
  if (/^0+-0+-0+$/.test(str)) return null;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    if (m === '00') return y;
    if (d === '00') return `${y}-${m}`;
    return `${y}-${m}-${d}`;
  }
  const dmy = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const m = MONTHS[dmy[2].toLowerCase()];
    if (m) return `${dmy[3]}-${m}-${String(dmy[1]).padStart(2, '0')}`;
  }
  const my = str.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (my) {
    const m = MONTHS[my[1].toLowerCase()];
    if (m) return `${my[2]}-${m}`;
  }
  const y = str.match(/^(\d{4})$/);
  if (y) return y[1];
  return null;
}

async function http(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

async function findAuthorId(name) {
  const url = `https://www.isfdb.org/cgi-bin/se.cgi?arg=${encodeURIComponent(name)}&type=Name`;
  const html = await http(url);
  // <a href="https://www.isfdb.org/cgi-bin/ea.cgi?N" dir="ltr">NAME</a>
  const re = /<a href="https:\/\/www\.isfdb\.org\/cgi-bin\/ea\.cgi\?(\d+)"[^>]*>([^<]+)<\/a>/g;
  const target = name.toLowerCase();
  let m;
  while ((m = re.exec(html))) {
    if (m[2].trim().toLowerCase() === target) return m[1];
  }
  return null;
}

async function fetchDates(authorId) {
  const html = await http(`https://www.isfdb.org/cgi-bin/ea.cgi?${authorId}`);
  const birth = html.match(/<b>Birthdate:<\/b>\s*([^\n<]+)/i)?.[1]?.trim();
  const death = html.match(/<b>Deathdate:<\/b>\s*([^\n<]+)/i)?.[1]?.trim();
  return {
    birth_date: parseIsfdbDate(birth),
    death_date: parseIsfdbDate(death),
  };
}

const candidates = db.prepare(`
  SELECT DISTINCT a.id, a.name, a.birth_date, a.death_date
  FROM authors a
  JOIN book_authors ba ON ba.author_id = a.id
  JOIN book_tags bt ON bt.book_id = ba.book_id
  JOIN tags t ON t.id = bt.tag_id
  WHERE t.name = 'Science Fiction'
    AND a.birth_date IS NULL
  ORDER BY a.name
`).all();

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log(`${candidates.length} SF authors missing birth_date`);
console.log(APPLY ? 'Mode: APPLY (writing changes)' : 'Mode: dry-run (re-run with --apply to write)');
console.log('');

let updated = 0, skipped = 0, failed = 0;
for (const author of candidates) {
  try {
    const id = await findAuthorId(author.name);
    if (!id) {
      console.log(`  SKIP ${author.name} — no exact-name match on ISFDB`);
      skipped++;
      await sleep(800);
      continue;
    }
    const dates = await fetchDates(id);
    if (!dates.birth_date && !dates.death_date) {
      console.log(`  SKIP ${author.name} (ea.cgi?${id}) — ISFDB has no dates`);
      skipped++;
      await sleep(800);
      continue;
    }
    const tag = `birth=${dates.birth_date ?? '—'} death=${dates.death_date ?? '—'}`;
    if (APPLY) {
      const body = {};
      if (dates.birth_date) body.birth_date = dates.birth_date;
      if (dates.death_date) body.death_date = dates.death_date;
      const res = await fetch(`http://localhost:${PORT}/api/authors/${author.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.log(`  FAIL ${author.name} — HTTP ${res.status}`);
        failed++;
      } else {
        console.log(`  ✓  ${author.name} ${tag}`);
        updated++;
      }
    } else {
      console.log(`  ?  ${author.name} ${tag}`);
      updated++;
    }
    await sleep(800);
  } catch (e) {
    console.log(`  FAIL ${author.name} — ${e.message}`);
    failed++;
    await sleep(800);
  }
}

console.log('');
console.log(`Summary: ${updated} ${APPLY ? 'updated' : 'would update'}, ${skipped} skipped, ${failed} failed.`);
