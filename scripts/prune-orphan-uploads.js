// One-shot: scan the four upload directories and delete files that
// have no corresponding DB reference. Four buckets:
//
//   uploads/*.{jpg,png,gif,webp}           ← books.cover_path
//   uploads/thumbs/*.jpg                    ← derived from covers
//   uploads/authors/*.{jpg,png,gif,webp}   ← authors.photo_path
//   uploads/authors/thumbs/*.jpg            ← derived from author photos
//
// A thumb is orphaned when its stem has no matching original in the
// parent directory OR when the parent is orphaned. Originals are
// orphaned when no DB row references them. Safe by construction:
// dry-run by default; --apply required to actually delete.
//
// Motivating case (2026-07-16 integrity audit): 946 orphan author
// photos and 27 orphan covers accumulated over months from paths I
// couldn't nail down statically (bio_fetched_at doesn't match the
// orphan timestamps, so the leak wasn't /refresh alone). Rather than
// chase phantom code, this script closes the loop periodically.
//
// Run:  ./scripts/with-toolchain.sh node scripts/prune-orphan-uploads.js
//   --apply       actually delete (default: dry-run listing counts)
//   --verbose     print every file inspected (default: totals only)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir  = path.join(__dirname, '..', 'uploads');
const authorsDir  = path.join(uploadsDir, 'authors');
const coverThumbs = path.join(uploadsDir, 'thumbs');
const authorThumbs= path.join(authorsDir, 'thumbs');

const APPLY   = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => EXTS.has(path.extname(name).toLowerCase()))
    .filter(name => {
      const abs = path.join(dir, name);
      try { return fs.statSync(abs).isFile(); } catch { return false; }
    });
}

function stem(filename) {
  const ext = path.extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

// Bare-filename set of covers referenced by any book row.
const referencedCovers = new Set(
  db.prepare("SELECT cover_path FROM books WHERE cover_path IS NOT NULL AND cover_path != ''")
    .all().map(r => r.cover_path)
);
// Bare-filename set of author photos referenced by any authors row.
const referencedPhotos = new Set(
  db.prepare("SELECT REPLACE(photo_path, '/uploads/authors/', '') AS f FROM authors WHERE photo_path IS NOT NULL AND photo_path != ''")
    .all().map(r => r.f)
);

const summary = { covers: 0, coverThumbs: 0, authorPhotos: 0, authorPhotoThumbs: 0 };
const bytes   = { covers: 0, coverThumbs: 0, authorPhotos: 0, authorPhotoThumbs: 0 };
const targets = [];

// Bucket 1: orphan cover originals
const coverFiles = listImages(uploadsDir);
for (const name of coverFiles) {
  if (referencedCovers.has(name)) continue;
  const abs = path.join(uploadsDir, name);
  const size = fs.statSync(abs).size;
  summary.covers++; bytes.covers += size;
  targets.push(abs);
  if (VERBOSE) console.log(`  orphan cover:        ${name}  (${Math.round(size/1024)} KB)`);
}

// Bucket 2: orphan cover thumbs — either their stem isn't a live
// cover, or the live cover is present but we're being defensive
// (thumbs regenerate cheaply, so no false-positive risk).
const referencedCoverStems = new Set([...referencedCovers].map(stem));
const coverThumbFiles = listImages(coverThumbs);
for (const name of coverThumbFiles) {
  if (referencedCoverStems.has(stem(name))) continue;
  const abs = path.join(coverThumbs, name);
  const size = fs.statSync(abs).size;
  summary.coverThumbs++; bytes.coverThumbs += size;
  targets.push(abs);
  if (VERBOSE) console.log(`  orphan cover thumb:  ${name}  (${Math.round(size/1024)} KB)`);
}

// Bucket 3: orphan author photo originals
const authorFiles = listImages(authorsDir);
for (const name of authorFiles) {
  if (referencedPhotos.has(name)) continue;
  const abs = path.join(authorsDir, name);
  const size = fs.statSync(abs).size;
  summary.authorPhotos++; bytes.authorPhotos += size;
  targets.push(abs);
  if (VERBOSE) console.log(`  orphan photo:        ${name}  (${Math.round(size/1024)} KB)`);
}

// Bucket 4: orphan author photo thumbs
const referencedPhotoStems = new Set([...referencedPhotos].map(stem));
const authorThumbFiles = listImages(authorThumbs);
for (const name of authorThumbFiles) {
  if (referencedPhotoStems.has(stem(name))) continue;
  const abs = path.join(authorThumbs, name);
  const size = fs.statSync(abs).size;
  summary.authorPhotoThumbs++; bytes.authorPhotoThumbs += size;
  targets.push(abs);
  if (VERBOSE) console.log(`  orphan photo thumb:  ${name}  (${Math.round(size/1024)} KB)`);
}

const totalFiles = targets.length;
const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0);
const mb = (n) => (n / 1024 / 1024).toFixed(2);

console.log('');
console.log('Orphan uploads found:');
console.log(`  cover originals:     ${summary.covers.toString().padStart(5)}  ${mb(bytes.covers)} MB`);
console.log(`  cover thumbs:        ${summary.coverThumbs.toString().padStart(5)}  ${mb(bytes.coverThumbs)} MB`);
console.log(`  author photos:       ${summary.authorPhotos.toString().padStart(5)}  ${mb(bytes.authorPhotos)} MB`);
console.log(`  author photo thumbs: ${summary.authorPhotoThumbs.toString().padStart(5)}  ${mb(bytes.authorPhotoThumbs)} MB`);
console.log(`  total:               ${totalFiles.toString().padStart(5)}  ${mb(totalBytes)} MB`);
console.log('');

if (!APPLY) {
  console.log('Dry-run. Re-run with --apply to delete.');
  process.exit(0);
}

let deleted = 0, failed = 0;
for (const abs of targets) {
  try { fs.unlinkSync(abs); deleted++; }
  catch (err) { console.error(`failed: ${abs}: ${err.message}`); failed++; }
}
console.log(`Deleted ${deleted} of ${totalFiles} orphan files${failed ? ` (${failed} failed)` : ''}.`);
