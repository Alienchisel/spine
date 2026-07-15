import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectImageExt, generateThumbBuffer } from '../books/covers.js';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'authors');
const THUMBS_DIR  = path.join(UPLOADS_DIR, 'thumbs');
// Author portraits get the same thumb treatment as book covers (see
// lib/books/covers.js): the Loved authors grid and the AuditWizard
// portrait strip decode full-resolution originals otherwise, and the
// Loved grid is a "many small tiles" pattern that used to strain the
// browser the same way BookCard did before 1.268.0. Thumbs live under
// /uploads/authors/thumbs/{stem}.jpg so the served-static /uploads
// tree keeps the two axes (books vs authors) separate.

// Shared by the OL download path and the manual upload route. WebP →
// JPG conversion mirrors saveCoverFromBuffer in lib/books/covers.js
// (the user dislikes WebP — see memory feedback_no_webp_covers.md).
function webpBufferToJpg(buffer) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('/usr/bin/convert', ['webp:-', '-quality', '90', 'jpg:-']);
    } catch (e) {
      return reject(e);
    }
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', c => chunks.push(c));
    proc.stderr.on('data', c => { stderr += c.toString(); });
    proc.stdin.on('error', reject);
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`convert exited ${code}: ${stderr}`));
    });
    proc.stdin.end(buffer);
  });
}

// Filename stem (basename minus extension) for an author photo file.
// Photo filenames are `${authorId}-${Date.now()}.${ext}` so the stem is
// stable; used to derive the /uploads/authors/thumbs/{stem}.jpg
// companion path.
export function authorPhotoBasenameStem(filename) {
  if (!filename) return null;
  if (path.basename(filename) !== filename) return null;
  const ext = path.extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

export function authorThumbAbsPath(filename) {
  const stem = authorPhotoBasenameStem(filename);
  return stem ? path.join(THUMBS_DIR, `${stem}.jpg`) : null;
}

// Generate + write the thumb for a just-saved author photo. Best-effort:
// any failure logs and returns null; the original stays on disk and the
// client's onError falls back to it via toAuthorThumbUrl.
export async function writeThumbForAuthorPhoto(filename, sourceBuffer) {
  const stem = authorPhotoBasenameStem(filename);
  if (!stem) return null;
  if (!detectImageExt(sourceBuffer)) return null;
  try {
    fsSync.mkdirSync(THUMBS_DIR, { recursive: true });
    const thumb = await generateThumbBuffer(sourceBuffer);
    const outPath = path.join(THUMBS_DIR, `${stem}.jpg`);
    await fs.writeFile(outPath, thumb);
    return outPath;
  } catch (err) {
    console.error(`Thumb generation failed for author photo ${filename}: ${err.message}`);
    return null;
  }
}

// Save a portrait image to uploads/authors/. Returns the URL-relative
// path ready to write straight into authors.photo_path, or throws if
// the buffer isn't a recognized image. Filename embeds authorId +
// timestamp so a later upload writes a fresh file and browsers don't
// show a stale cached portrait. A companion max-400px-wide JPG thumb
// is written to uploads/authors/thumbs/{stem}.jpg alongside — served
// by the Loved / AuditWizard grids to avoid full-decode blowup.
export async function saveAuthorPhotoFromBuffer(authorId, buffer) {
  let ext = detectImageExt(buffer);
  if (!ext) throw new Error('Unrecognized image format');
  if (ext === 'webp') {
    buffer = await webpBufferToJpg(buffer);
    ext = 'jpg';
  }
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${authorId}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);
  // Best-effort thumb — see writeThumbForAuthorPhoto.
  await writeThumbForAuthorPhoto(filename, buffer);
  return `/uploads/authors/${filename}`;
}

// Best-effort delete of a previous photo file when a refresh / upload
// replaces it. Errors swallowed — leaving the old file is harmless and
// the next backup picks both up. Path-traversal guard rejects anything
// that isn't a bare filename under the authors directory. Companion
// thumb goes with the original.
export async function deleteAuthorPhoto(photoPath) {
  if (!photoPath || !photoPath.startsWith('/uploads/authors/')) return;
  const filename = photoPath.slice('/uploads/authors/'.length);
  if (!/^[\w.-]+$/.test(filename)) return;
  try {
    await fs.unlink(path.join(UPLOADS_DIR, filename));
  } catch {
    // Already gone or never existed.
  }
  const thumbPath = authorThumbAbsPath(filename);
  if (thumbPath) {
    try { await fs.unlink(thumbPath); } catch { /* ENOENT swallowed */ }
  }
}
