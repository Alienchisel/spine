import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectImageExt } from '../books/covers.js';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'authors');

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

// Save a portrait image to uploads/authors/. Returns the URL-relative
// path ready to write straight into authors.photo_path, or throws if
// the buffer isn't a recognized image. Filename embeds authorId +
// timestamp so a later upload writes a fresh file and browsers don't
// show a stale cached portrait.
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
  return `/uploads/authors/${filename}`;
}

// Best-effort delete of a previous photo file when a refresh / upload
// replaces it. Errors swallowed — leaving the old file is harmless and
// the next backup picks both up. Path-traversal guard rejects anything
// that isn't a bare filename under the authors directory.
export async function deleteAuthorPhoto(photoPath) {
  if (!photoPath || !photoPath.startsWith('/uploads/authors/')) return;
  const filename = photoPath.slice('/uploads/authors/'.length);
  if (!/^[\w.-]+$/.test(filename)) return;
  try {
    await fs.unlink(path.join(UPLOADS_DIR, filename));
  } catch {
    // Already gone or never existed.
  }
}
