// One-shot: walk every books.cover_path with a real file on disk and
// generate the /uploads/thumbs/{stem}.jpg companion if it doesn't
// already exist. Idempotent (skips existing thumbs), resumable (a
// re-run picks up where the previous stopped), and best-effort per
// file (a broken source is logged and skipped, not fatal).
//
// This closes the gap for the ~2,300 covers that predate the thumb
// pipeline. New uploads go through saveCoverFromBuffer → writeThumbForCover
// so they don't need this script; only historical rows do.
//
// Run:  ./scripts/with-toolchain.sh node scripts/backfill-cover-thumbs.js
//   --limit=N       process only the first N covers (default: all)
//   --force         regenerate even if a thumb already exists
//
// No --apply flag: this script is safe by construction — it only writes
// new files under uploads/thumbs/, never mutates the DB or overwrites
// originals. Existing thumbs are skipped unless --force.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { generateThumbBuffer, coverBasenameStem, thumbAbsPath } from '../lib/books/covers.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir  = path.join(__dirname, '..', 'uploads');
const thumbsDir   = path.join(uploadsDir, 'thumbs');

const argv = process.argv.slice(2);
const LIMIT_FLAG = argv.find(a => a.startsWith('--limit='));
const LIMIT      = LIMIT_FLAG ? Number(LIMIT_FLAG.slice('--limit='.length)) : Infinity;
const FORCE      = argv.includes('--force');

fs.mkdirSync(thumbsDir, { recursive: true });

// Cover paths in the DB are stored as '/uploads/{basename}'. Strip the
// prefix so we can resolve to a filesystem path.
const rows = db.prepare(`
  SELECT id, title, cover_path, cover_bytes
  FROM books
  WHERE cover_path IS NOT NULL AND cover_path != ''
  ORDER BY id
`).all();

console.log(`${rows.length} book(s) with a cover_path on record`);
if (Number.isFinite(LIMIT)) console.log(`Limit: first ${LIMIT}`);
console.log(FORCE ? 'Mode: --force (regenerating all thumbs)' : 'Mode: incremental (skipping existing thumbs)');
console.log('');

let generated = 0, skippedExisting = 0, skippedMissingSource = 0, failed = 0;
let processed = 0;
const t0 = Date.now();

for (const row of rows) {
  if (processed >= LIMIT) break;
  processed++;
  // books.cover_path stores the bare filename; the '/uploads/' prefix is
  // added by toCoverUrl() at API-serialise time. Tolerate both shapes so
  // this script works on a hand-edited row too.
  const filename = row.cover_path.startsWith('/uploads/')
    ? row.cover_path.slice('/uploads/'.length)
    : row.cover_path;
  if (!filename || filename.includes('/')) {
    console.log(`  ?? #${row.id} ${row.title.slice(0, 40)} — cover_path shape unexpected: ${row.cover_path}`);
    skippedMissingSource++;
    continue;
  }
  const stem = coverBasenameStem(filename);
  if (!stem) { skippedMissingSource++; continue; }
  const thumbPath = thumbAbsPath(filename);
  if (!FORCE && fs.existsSync(thumbPath)) {
    skippedExisting++;
    continue;
  }
  const sourcePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(sourcePath)) {
    console.log(`  -- #${row.id} ${row.title.slice(0, 40)} — source file missing (${filename})`);
    skippedMissingSource++;
    continue;
  }
  try {
    const source = fs.readFileSync(sourcePath);
    const thumb  = await generateThumbBuffer(source);
    fs.writeFileSync(thumbPath, thumb);
    generated++;
    // Compact progress line — one per success, no per-book noise for skips.
    const kbFrom = Math.round(source.length / 1024);
    const kbTo   = Math.round(thumb.length / 1024);
    if (generated % 25 === 0 || generated === 1) {
      const secs = Math.round((Date.now() - t0) / 1000);
      console.log(`  ok #${row.id}  ${kbFrom} KB → ${kbTo} KB  (${generated} done in ${secs}s)`);
    }
  } catch (err) {
    console.log(`  !! #${row.id} ${row.title.slice(0, 40)} — ${err.message}`);
    failed++;
  }
}

const secs = Math.round((Date.now() - t0) / 1000);
console.log('');
console.log(`Summary: ${generated} generated, ${skippedExisting} already had thumbs, ${skippedMissingSource} source missing / malformed, ${failed} failed. (${processed} processed in ${secs}s)`);
