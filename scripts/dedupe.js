// Formal de-dupe CLI for authors and publishers. Replaces the ad-hoc
// SQL-via-sqlite3 we'd been running for one-off Rivarol-shape merges,
// with a confirmation prompt + pre-merge snapshot before any
// destructive change.
//
// Usage:
//   node scripts/dedupe.js scan-{authors,narrators,translators,publishers}
//   node scripts/dedupe.js merge-{author,narrator,translator} <keep_id> <drop_id> [--yes]
//   node scripts/dedupe.js rename-publisher "<old>" "<new>" [--yes]
//
// Scans use a relaxed-normalization grouping (lowercased, diacritics
// stripped, particles like "de"/"von"/"the" removed for authors,
// imprint suffixes like "Press"/"Publishing" stripped for publishers)
// to surface candidate clusters. Merge / rename actions take exact
// IDs / strings — the operator chooses which row wins. Always
// snapshots first (backups/spine-pre-dedup-<label>-<ts>.db).

import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'fs';
import db from '../db.js';
import { mergeAuthors } from '../lib/books/people.js';
import { deleteAuthorPhoto } from '../lib/authors/photos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Narrators and translators are simpler than authors — name-only tables
// with no bio / photo / dates / alias group — so they share a generic
// scan/merge pair rather than duplicating the author code.
function scanSimplePersons(table, junction, fkCol, kindLabel) {
  const rows = db.prepare(`
    SELECT p.id, p.name,
           (SELECT COUNT(*) FROM ${junction} WHERE ${fkCol} = p.id) AS book_count
    FROM ${table} p
    ORDER BY p.name
  `).all();
  const groups = new Map();
  for (const r of rows) {
    const norm = normalizeName(r.name);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push(r);
  }
  const dupes = [...groups.entries()].filter(([, g]) => g.length > 1);
  if (!dupes.length) { console.log(`No ${kindLabel} duplicate candidates.`); return; }
  console.log(`${dupes.length} candidate group(s):\n`);
  for (const [norm, group] of dupes) {
    console.log(`[${norm}]`);
    for (const r of group) {
      console.log(`  ${String(r.id).padStart(4)}  ${r.name}  (${r.book_count} books)`);
    }
    console.log('');
  }
  console.log(`Merge with:  node scripts/dedupe.js merge-${kindLabel} <keep_id> <drop_id>`);
}

async function mergeSimplePerson(table, junction, fkCol, kindLabel, keepIdStr, dropIdStr, autoYes) {
  const keepId = parseInt(keepIdStr, 10);
  const dropId = parseInt(dropIdStr, 10);
  if (!Number.isInteger(keepId) || !Number.isInteger(dropId) || keepId === dropId) {
    console.error(`Usage: dedupe.js merge-${kindLabel} <keep_id> <drop_id>`);
    process.exit(1);
  }
  const keep = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(keepId);
  const drop = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(dropId);
  if (!keep) { console.error(`${kindLabel} #${keepId} not found.`); process.exit(1); }
  if (!drop) { console.error(`${kindLabel} #${dropId} not found.`); process.exit(1); }

  const keepBooks = db.prepare(`SELECT book_id FROM ${junction} WHERE ${fkCol} = ?`).all(keepId);
  const dropBooks = db.prepare(`SELECT book_id FROM ${junction} WHERE ${fkCol} = ?`).all(dropId);
  const keepBookIds = new Set(keepBooks.map(b => b.book_id));
  const overlap = dropBooks.filter(b => keepBookIds.has(b.book_id));
  const exclusive = dropBooks.filter(b => !keepBookIds.has(b.book_id));

  console.log(`\nMerging two ${kindLabel}s:`);
  console.log(`  KEEP  #${keep.id}  ${keep.name}  (${keepBooks.length} books)`);
  console.log(`  DROP  #${drop.id}  ${drop.name}  (${dropBooks.length} books)`);
  console.log(`\nPlan:`);
  console.log(`  • re-attribute ${exclusive.length} book row(s) from drop → keep`);
  if (overlap.length) console.log(`  • drop ${overlap.length} duplicate attribution row(s) (book already credits keep)`);
  console.log(`  • delete ${table} row #${drop.id}\n`);

  if (!await confirm('Proceed?', autoYes)) { console.log('Aborted.'); return; }

  const snap = snapshot(db, `${kindLabel}-${dropId}-into-${keepId}`);
  console.log(`Snapshot:  ${snap}`);

  db.transaction(() => {
    if (overlap.length) {
      db.prepare(`DELETE FROM ${junction} WHERE ${fkCol} = ? AND book_id IN (${overlap.map(() => '?').join(',')})`)
        .run(dropId, ...overlap.map(b => b.book_id));
    }
    db.prepare(`UPDATE ${junction} SET ${fkCol} = ? WHERE ${fkCol} = ?`).run(keepId, dropId);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(dropId);
  })();

  console.log(`Merged. #${dropId} (${drop.name}) → #${keepId} (${keep.name}).`);
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

// Author merge delegates to lib/books/people.js#mergeAuthors — the same
// transaction the POST /api/authors/:id/merge endpoint uses. Previously
// the CLI reimplemented the merge and drifted from the canonical logic
// (missed story_authors → silent story-credit loss on delete-cascade,
// missed bio_fetched_at / default_sort / showcase_position / OR-merged
// loved, missed alias-group dissolution, orphaned photo files on disk).
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

  const keepBooks = db.prepare('SELECT COUNT(*) AS n FROM book_authors WHERE author_id = ?').get(keepId).n;
  const dropBooks = db.prepare('SELECT COUNT(*) AS n FROM book_authors WHERE author_id = ?').get(dropId).n;
  const keepStories = db.prepare('SELECT COUNT(*) AS n FROM story_authors WHERE author_id = ?').get(keepId).n;
  const dropStories = db.prepare('SELECT COUNT(*) AS n FROM story_authors WHERE author_id = ?').get(dropId).n;
  const bookOverlap = db.prepare(`
    SELECT COUNT(*) AS n FROM book_authors
    WHERE author_id = ? AND book_id IN (SELECT book_id FROM book_authors WHERE author_id = ?)
  `).get(dropId, keepId).n;
  const storyOverlap = db.prepare(`
    SELECT COUNT(*) AS n FROM story_authors
    WHERE author_id = ? AND story_id IN (SELECT story_id FROM story_authors WHERE author_id = ?)
  `).get(dropId, keepId).n;

  // mergeAuthors COALESCEs every metadata field survivor-first. Preview
  // which of keep's blanks the drop will fill.
  const FIELDS = ['bio', 'photo_path', 'birth_date', 'death_date', 'gender',
                  'ol_key', 'bio_fetched_at', 'default_sort', 'showcase_position'];
  const willFill = FIELDS.filter(f => (keep[f] == null || keep[f] === '') && drop[f] != null && drop[f] !== '');
  const willLove = !keep.loved && drop.loved;
  const inheritAlias = drop.alias_group_id && !keep.alias_group_id;
  const orphansPhoto = keep.photo_path && drop.photo_path && keep.photo_path !== drop.photo_path;

  console.log(`\nMerging two authors:`);
  console.log(`  KEEP  #${keep.id}  ${keep.name}`);
  console.log(`        ${keepBooks} books · ${keepStories} stories · bio=${keep.bio ? 'Y' : '·'} · photo=${keep.photo_path ? 'Y' : '·'} · dates=${keep.birth_date || keep.death_date ? 'Y' : '·'}`);
  console.log(`  DROP  #${drop.id}  ${drop.name}`);
  console.log(`        ${dropBooks} books · ${dropStories} stories · bio=${drop.bio ? 'Y' : '·'} · photo=${drop.photo_path ? 'Y' : '·'} · dates=${drop.birth_date || drop.death_date ? 'Y' : '·'}`);
  console.log(`\nPlan:`);
  console.log(`  • re-attribute ${dropBooks - bookOverlap} book row(s) from drop → keep`);
  if (bookOverlap) console.log(`  • drop ${bookOverlap} duplicate book-attribution row(s) (book already credits keep)`);
  if (dropStories) console.log(`  • re-attribute ${dropStories - storyOverlap} story row(s) from drop → keep`);
  if (storyOverlap) console.log(`  • drop ${storyOverlap} duplicate story-attribution row(s) (story already credits keep)`);
  if (willFill.length) console.log(`  • fill keep's blanks with drop's: ${willFill.join(', ')}`);
  if (willLove)        console.log(`  • OR-merge loved onto keep`);
  if (inheritAlias)    console.log(`  • inherit alias_group_id=${drop.alias_group_id} onto keep`);
  if (orphansPhoto)    console.log(`  • delete drop's orphaned photo file (${drop.photo_path})`);
  console.log(`  • delete authors row #${drop.id}\n`);

  if (!await confirm('Proceed?', autoYes)) { console.log('Aborted.'); return; }

  const snap = snapshot(db, `author-${dropId}-into-${keepId}`);
  console.log(`Snapshot:  ${snap}`);

  const result = mergeAuthors(keepId, dropId);
  if (result === null) { console.error('Merge failed — author disappeared between preview and commit.'); process.exit(1); }
  if (result.orphanPhotoPath) await deleteAuthorPhoto(result.orphanPhotoPath).catch(() => {});

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
  'scan-authors':      () => scanAuthors(),
  'scan-narrators':    () => scanSimplePersons('narrators',   'book_narrators',   'narrator_id',   'narrator'),
  'scan-translators':  () => scanSimplePersons('translators', 'book_translators', 'translator_id', 'translator'),
  'scan-publishers':   () => scanPublishers(),
  'merge-author':      () => mergeAuthor(rest[0], rest[1], autoYes),
  'merge-narrator':    () => mergeSimplePerson('narrators',   'book_narrators',   'narrator_id',   'narrator',   rest[0], rest[1], autoYes),
  'merge-translator':  () => mergeSimplePerson('translators', 'book_translators', 'translator_id', 'translator', rest[0], rest[1], autoYes),
  'rename-publisher':  () => renamePublisher(rest[0], rest[1], autoYes),
};

const fn = commands[cmd];
if (!fn) {
  console.log('Usage:');
  console.log('  node scripts/dedupe.js scan-authors');
  console.log('  node scripts/dedupe.js scan-narrators');
  console.log('  node scripts/dedupe.js scan-translators');
  console.log('  node scripts/dedupe.js scan-publishers');
  console.log('  node scripts/dedupe.js merge-author <keep_id> <drop_id> [--yes]');
  console.log('  node scripts/dedupe.js merge-narrator <keep_id> <drop_id> [--yes]');
  console.log('  node scripts/dedupe.js merge-translator <keep_id> <drop_id> [--yes]');
  console.log('  node scripts/dedupe.js rename-publisher "<old>" "<new>" [--yes]');
  process.exit(1);
}

Promise.resolve(fn()).catch(err => { console.error(err); process.exit(1); });
