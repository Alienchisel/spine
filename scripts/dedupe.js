// Formal de-dupe CLI for authors and publishers. Replaces the ad-hoc
// SQL-via-sqlite3 we'd been running for one-off Rivarol-shape merges,
// with a confirmation prompt + pre-merge snapshot before any
// destructive change.
//
// Usage:
//   node scripts/dedupe.js scan-authors
//   node scripts/dedupe.js scan-publishers
//   node scripts/dedupe.js merge-author <keep_id> <drop_id> [--yes]
//   node scripts/dedupe.js rename-publisher "<old>" "<new>" [--yes]
//
// Scans use a relaxed-normalization grouping (lowercased, diacritics
// stripped, particles like "de"/"von"/"the" removed for authors,
// imprint suffixes like "Press"/"Publishing" stripped for publishers)
// to surface candidate clusters. Merge / rename actions take exact
// IDs / strings — the operator chooses which row wins. Always
// snapshots first (backups/spine-pre-dedup-<label>-<ts>.db).

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'spine.db');

const PARTICLES = new Set([
  'de', 'von', 'van', 'der', 'le', 'la', 'du', 'di', 'da', 'del', 'della',
  'the', 'el', 'al', 'bin', 'ibn',
  'saint', 'st',
  'sir', 'dr', 'mr', 'mrs', 'ms', 'prof', 'professor',
  'jr', 'sr', 'i', 'ii', 'iii', 'iv', 'v',
]);

const IMPRINT_WORDS = new Set([
  'press', 'publishing', 'publications', 'publishers', 'publisher',
  'books', 'book', 'editions', 'edition',
  'house', 'media', 'imprint',
  'inc', 'ltd', 'llc', 'gmbh', 'sa', 'spa',
  'group', 'company', 'co',
  'the', 'and', '&',
]);

// U+0300..U+036F is the Combining Diacritical Marks block — what NFKD
// decomposes accented latin letters into (so "é" becomes "e" + U+0301).
const DIACRITICS_RE = /[\u0300-\u036f]/g;

function normalizeName(s) {
  return s
    .toLowerCase()
    .normalize('NFKD').replace(DIACRITICS_RE, '')
    .split(/[\s.,'`’\-]+/)
    .filter(w => w && !PARTICLES.has(w))
    .join(' ')
    .trim();
}

function normalizePublisher(s) {
  return s
    .toLowerCase()
    .normalize('NFKD').replace(DIACRITICS_RE, '')
    .split(/[\s.,'`’\-]+/)
    .filter(w => w && !IMPRINT_WORDS.has(w))
    .join(' ')
    .trim();
}

function snapshot(db, label) {
  // ms precision + random suffix so back-to-back rename runs in the same
  // second don't collide on the snapshot path (VACUUM INTO refuses to
  // overwrite an existing file, so a collision aborts the whole rename).
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `spine-pre-dedup-${label}-${ts}-${rand}.db`);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  return out;
}

async function confirm(msg, autoYes) {
  if (autoYes) { console.log(`${msg} [auto-yes]`); return true; }
  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question(`${msg} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function scanAuthors() {
  const rows = db.prepare(`
    SELECT a.id, a.name,
           CASE WHEN a.bio        IS NOT NULL AND TRIM(a.bio) != '' THEN 1 ELSE 0 END AS has_bio,
           CASE WHEN a.photo_path IS NOT NULL THEN 1 ELSE 0 END                       AS has_photo,
           a.alias_group_id,
           (SELECT COUNT(*) FROM book_authors WHERE author_id = a.id) AS book_count
    FROM authors a
    ORDER BY a.name
  `).all();
  const groups = new Map();
  for (const r of rows) {
    const norm = normalizeName(r.name);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push(r);
  }
  const dupes = [...groups.entries()].filter(([, g]) => g.length > 1);
  if (!dupes.length) { console.log('No author duplicate candidates.'); return; }
  console.log(`${dupes.length} candidate group(s):\n`);
  for (const [norm, group] of dupes) {
    console.log(`[${norm}]`);
    for (const r of group) {
      const meta = [];
      if (r.has_bio)   meta.push('bio');
      if (r.has_photo) meta.push('photo');
      if (r.alias_group_id) meta.push(`alias_group=${r.alias_group_id}`);
      console.log(`  ${String(r.id).padStart(4)}  ${r.name}  (${r.book_count} books)${meta.length ? '  [' + meta.join(', ') + ']' : ''}`);
    }
    console.log('');
  }
  console.log('Merge with:  node scripts/dedupe.js merge-author <keep_id> <drop_id>');
}

function scanPublishers() {
  const rows = db.prepare(`
    SELECT publisher, COUNT(*) AS c
    FROM books
    WHERE publisher IS NOT NULL AND publisher != ''
    GROUP BY publisher
    ORDER BY publisher
  `).all();
  const groups = new Map();
  for (const r of rows) {
    const norm = normalizePublisher(r.publisher);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push(r);
  }
  const dupes = [...groups.entries()].filter(([, g]) => g.length > 1);
  if (!dupes.length) { console.log('No publisher duplicate candidates.'); return; }
  console.log(`${dupes.length} candidate group(s):\n`);
  for (const [norm, group] of dupes) {
    console.log(`[${norm}]`);
    for (const r of group) {
      console.log(`  ${String(r.c).padStart(4)} books  "${r.publisher}"`);
    }
    console.log('');
  }
  console.log('Rename with:  node scripts/dedupe.js rename-publisher "<old>" "<new>"');
}

async function mergeAuthor(keepIdStr, dropIdStr, autoYes) {
  const keepId = parseInt(keepIdStr, 10);
  const dropId = parseInt(dropIdStr, 10);
  if (!Number.isInteger(keepId) || !Number.isInteger(dropId) || keepId === dropId) {
    console.error('Usage: dedupe.js merge-author <keep_id> <drop_id>');
    process.exit(1);
  }
  const keep = db.prepare('SELECT * FROM authors WHERE id = ?').get(keepId);
  const drop = db.prepare('SELECT * FROM authors WHERE id = ?').get(dropId);
  if (!keep) { console.error(`Author #${keepId} not found.`); process.exit(1); }
  if (!drop) { console.error(`Author #${dropId} not found.`); process.exit(1); }
  if (drop.alias_group_id && keep.alias_group_id && drop.alias_group_id !== keep.alias_group_id) {
    console.error(`Both authors are in different alias groups (keep=${keep.alias_group_id}, drop=${drop.alias_group_id}). Unlink the drop side first via DELETE /api/authors/${dropId}/alias-link.`);
    process.exit(1);
  }

  const keepBooks = db.prepare('SELECT book_id, position FROM book_authors WHERE author_id = ?').all(keepId);
  const dropBooks = db.prepare('SELECT book_id, position FROM book_authors WHERE author_id = ?').all(dropId);
  const keepBookIds = new Set(keepBooks.map(b => b.book_id));
  const overlap = dropBooks.filter(b => keepBookIds.has(b.book_id));
  const exclusive = dropBooks.filter(b => !keepBookIds.has(b.book_id));

  const willCopy = [];
  for (const f of ['bio', 'photo_path', 'birth_date', 'death_date', 'gender', 'ol_key']) {
    if (!keep[f] && drop[f]) willCopy.push(f);
  }
  const inheritAlias = drop.alias_group_id && !keep.alias_group_id;

  console.log(`\nMerging two authors:`);
  console.log(`  KEEP  #${keep.id}  ${keep.name}`);
  console.log(`        ${keepBooks.length} books · bio=${keep.bio ? 'Y' : '·'} · photo=${keep.photo_path ? 'Y' : '·'} · dates=${keep.birth_date || keep.death_date ? 'Y' : '·'}`);
  console.log(`  DROP  #${drop.id}  ${drop.name}`);
  console.log(`        ${dropBooks.length} books · bio=${drop.bio ? 'Y' : '·'} · photo=${drop.photo_path ? 'Y' : '·'} · dates=${drop.birth_date || drop.death_date ? 'Y' : '·'}`);
  console.log(`\nPlan:`);
  console.log(`  • re-attribute ${exclusive.length} book row(s) from drop → keep`);
  if (overlap.length) console.log(`  • drop ${overlap.length} duplicate attribution row(s) (book already credits keep)`);
  if (willCopy.length) console.log(`  • copy fields where keep is empty: ${willCopy.join(', ')}`);
  if (inheritAlias)    console.log(`  • inherit alias_group_id=${drop.alias_group_id} onto keep`);
  console.log(`  • delete authors row #${drop.id}\n`);

  if (!await confirm('Proceed?', autoYes)) { console.log('Aborted.'); return; }

  const snap = snapshot(db, `author-${dropId}-into-${keepId}`);
  console.log(`Snapshot:  ${snap}`);

  db.transaction(() => {
    if (overlap.length) {
      db.prepare(`DELETE FROM book_authors WHERE author_id = ? AND book_id IN (${overlap.map(() => '?').join(',')})`)
        .run(dropId, ...overlap.map(b => b.book_id));
    }
    db.prepare('UPDATE book_authors SET author_id = ? WHERE author_id = ?').run(keepId, dropId);
    const sets = [];
    const params = [];
    for (const f of willCopy) { sets.push(`${f} = ?`); params.push(drop[f]); }
    if (inheritAlias)        { sets.push('alias_group_id = ?'); params.push(drop.alias_group_id); }
    if (sets.length) {
      params.push(keepId);
      db.prepare(`UPDATE authors SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    db.prepare('DELETE FROM authors WHERE id = ?').run(dropId);
  })();

  console.log(`Merged. #${dropId} (${drop.name}) → #${keepId} (${keep.name}).`);
}

async function renamePublisher(oldName, newName, autoYes) {
  if (oldName == null || newName == null) {
    console.error('Usage: dedupe.js rename-publisher "<old>" "<new>"');
    process.exit(1);
  }
  if (oldName === newName) { console.log('Old and new are identical — nothing to do.'); return; }
  const affected = db.prepare('SELECT COUNT(*) AS n FROM books WHERE publisher = ?').get(oldName).n;
  if (!affected) { console.log(`No books with publisher = "${oldName}".`); return; }
  console.log(`Will UPDATE ${affected} book(s): publisher "${oldName}" → "${newName}".`);
  if (!await confirm('Proceed?', autoYes)) { console.log('Aborted.'); return; }
  const snap = snapshot(db, `publisher-rename`);
  console.log(`Snapshot:  ${snap}`);
  const r = db.prepare('UPDATE books SET publisher = ? WHERE publisher = ?').run(newName, oldName);
  console.log(`Updated ${r.changes} book(s).`);
}

const argv = process.argv.slice(2);
const autoYes = argv.includes('--yes');
const args = argv.filter(a => a !== '--yes');
const [cmd, ...rest] = args;

const commands = {
  'scan-authors':     () => scanAuthors(),
  'scan-publishers':  () => scanPublishers(),
  'merge-author':     () => mergeAuthor(rest[0], rest[1], autoYes),
  'rename-publisher': () => renamePublisher(rest[0], rest[1], autoYes),
};

const fn = commands[cmd];
if (!fn) {
  console.log('Usage:');
  console.log('  node scripts/dedupe.js scan-authors');
  console.log('  node scripts/dedupe.js scan-publishers');
  console.log('  node scripts/dedupe.js merge-author <keep_id> <drop_id> [--yes]');
  console.log('  node scripts/dedupe.js rename-publisher "<old>" "<new>" [--yes]');
  process.exit(1);
}

Promise.resolve(fn()).catch(err => { console.error(err); process.exit(1); });
