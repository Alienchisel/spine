import fs from 'fs/promises';
import path from 'path';
import { AUTHOR_PHOTOS_DIR, AUTHOR_THUMBS_DIR } from '../paths.js';
import { detectImageExt, filenameStem, webpBufferToJpg, writeThumb } from '../images.js';

// Author portraits get the same treatment as book covers — WebP → JPG on
// intake, a max-400px thumb beside the original — through the shared
// pipeline in lib/images.js (this file used to carry its own copy). Thumbs
// live under /uploads/authors/thumbs/{stem}.jpg so the served /uploads tree
// keeps books and authors apart; the Loved authors grid and the audit
// wizard's portrait strip serve them instead of full-size originals.

// Filename stem for an author photo. Photo filenames are
// `${authorId}-${Date.now()}.${ext}`, so the stem is stable; used to
// derive the /uploads/authors/thumbs/{stem}.jpg companion path.
export const authorPhotoBasenameStem = filenameStem;

export function authorThumbAbsPath(filename) {
  const stem = authorPhotoBasenameStem(filename);
  return stem ? path.join(AUTHOR_THUMBS_DIR, `${stem}.jpg`) : null;
}

// Best-effort thumb for a just-saved portrait (see writeThumb).
export function writeThumbForAuthorPhoto(filename, sourceBuffer) {
  return writeThumb(AUTHOR_THUMBS_DIR, filename, sourceBuffer, 'author photo');
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
  await fs.mkdir(AUTHOR_PHOTOS_DIR, { recursive: true });
  const filename = `${authorId}-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(AUTHOR_PHOTOS_DIR, filename), buffer);
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
    await fs.unlink(path.join(AUTHOR_PHOTOS_DIR, filename));
  } catch {
    // Already gone or never existed.
  }
  const thumbPath = authorThumbAbsPath(filename);
  if (thumbPath) {
    try { await fs.unlink(thumbPath); } catch { /* ENOENT swallowed */ }
  }
}
