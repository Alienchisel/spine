// One-shot: walk every authors.photo_path with a real file on disk
// under uploads/authors/ and generate the /uploads/authors/thumbs/{stem}.jpg
// companion if it doesn't already exist. Same shape as
// scripts/backfill-cover-thumbs.js — idempotent, resumable, best-effort
// per file.
//
// Runs after 1.268.3 ships the author-photo thumb pipeline so existing
// portraits get their thumbs and the Loved authors grid + AuditWizard
// portrait strip stop paying the decode tax on originals.
//
// Run:  ./scripts/with-toolchain.sh node scripts/backfill-author-photo-thumbs.js
//   --limit=N   process only the first N photos (default: all)
//   --force     regenerate even if a thumb already exists

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { generateThumbBuffer } from '../lib/books/covers.js';
import { authorPhotoBasenameStem, authorThumbAbsPath } from '../lib/authors/photos.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const authorsDir  = path.join(__dirname, '..', 'uploads', 'authors');
const thumbsDir   = path.join(authorsDir, 'thumbs');

const argv = process.argv.slice(2);
const LIMIT_FLAG = argv.find(a => a.startsWith('--limit='));
const LIMIT      = LIMIT_FLAG ? Number(LIMIT_FLAG.slice('--limit='.length)) : Infinity;
const FORCE      = argv.includes('--force');

fs.mkdirSync(thumbsDir, { recursive: true });

// photos.js stores photo_path as '/uploads/authors/{filename}'.
const rows = db.prepare(`
  SELECT id, name, photo_path
  FROM authors
  WHERE photo_path IS NOT NULL AND photo_path != ''
  ORDER BY id
`).all();

console.log(`${rows.length} author(s) with a photo_path on record`);
if (Number.isFinite(LIMIT)) console.log(`Limit: first ${LIMIT}`);
console.log(FORCE ? 'Mode: --force (regenerating all thumbs)' : 'Mode: incremental (skipping existing thumbs)');
console.log('');

let generated = 0, skippedExisting = 0, skippedMissingSource = 0, failed = 0;
let processed = 0;
const t0 = Date.now();

for (const row of rows) {
  if (processed >= LIMIT) break;
  processed++;
  const prefix = '/uploads/authors/';
  const filename = row.photo_path.startsWith(prefix)
    ? row.photo_path.slice(prefix.length)
    : null;
  if (!filename || filename.includes('/')) {
    console.log(`  ?? #${row.id} ${row.name.slice(0, 40)} — photo_path shape unexpected: ${row.photo_path}`);
    skippedMissingSource++;
    continue;
  }
  const stem = authorPhotoBasenameStem(filename);
  if (!stem) { skippedMissingSource++; continue; }
  const thumbPath = authorThumbAbsPath(filename);
  if (!FORCE && fs.existsSync(thumbPath)) {
    skippedExisting++;
    continue;
  }
  const sourcePath = path.join(authorsDir, filename);
  if (!fs.existsSync(sourcePath)) {
    console.log(`  -- #${row.id} ${row.name.slice(0, 40)} — source file missing (${filename})`);
    skippedMissingSource++;
    continue;
  }
  try {
    const source = fs.readFileSync(sourcePath);
    const thumb  = await generateThumbBuffer(source);
    fs.writeFileSync(thumbPath, thumb);
    generated++;
    if (generated % 25 === 0 || generated === 1) {
      const kbFrom = Math.round(source.length / 1024);
      const kbTo   = Math.round(thumb.length / 1024);
      const secs = Math.round((Date.now() - t0) / 1000);
      console.log(`  ok #${row.id}  ${kbFrom} KB → ${kbTo} KB  (${generated} done in ${secs}s)`);
    }
  } catch (err) {
    console.log(`  !! #${row.id} ${row.name.slice(0, 40)} — ${err.message}`);
    failed++;
  }
}

const secs = Math.round((Date.now() - t0) / 1000);
console.log('');
console.log(`Summary: ${generated} generated, ${skippedExisting} already had thumbs, ${skippedMissingSource} source missing / malformed, ${failed} failed. (${processed} processed in ${secs}s)`);
