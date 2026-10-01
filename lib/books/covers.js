import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR, COVER_THUMBS_DIR } from '../paths.js';
import { detectImageExt, filenameStem, generateThumbBuffer, webpBufferToJpg, writeThumb } from '../images.js';
import { fetchOnce, downloadImage } from '../http/fetch.js';

// The image plumbing (ImageMagick, WebP → JPG, thumbs, magic-byte sniff)
// lives in lib/images.js, shared with author portraits; re-exported here
// for existing importers (repository, scripts, tests).
export { detectImageExt, generateThumbBuffer };

// Thumb pipeline: display grids decode covers at native resolution, so a
// 2000×3000 upload eats ~24 MB of pixel buffer per tile — 200 books ≈ 5 GB
// of decoded pixels and the browser locks up. The thumb is a max-400px-
// wide JPG served at /uploads/thumbs/{basename}.jpg; original stays for
// BookDetail's cover lightbox.

// Basename stem for a cover filename — strips the extension. The upload
// pipeline generates {epoch}-{random}.{ext}, so the stem is stable across
// re-derivations. Used by the thumb path so the /uploads/thumbs/{stem}.jpg
// URL is a pure function of the original cover_path.
export const coverBasenameStem = filenameStem;

export function thumbAbsPath(coverFilename) {
  const stem = coverBasenameStem(coverFilename);
  return stem ? path.join(COVER_THUMBS_DIR, `${stem}.jpg`) : null;
}

// Generate + write the thumb for a just-saved cover. Best-effort (see
// writeThumb): a failure logs and the original still serves.
export function writeThumbForCover(coverFilename, sourceBuffer) {
  return writeThumb(COVER_THUMBS_DIR, coverFilename, sourceBuffer, 'cover');
}

export function deleteThumbForCover(coverFilename) {
  const p = thumbAbsPath(coverFilename);
  if (!p) return;
  fs.unlink(p, (err) => {
    if (err && err.code !== 'ENOENT') console.error(`Failed to delete thumb: ${p}`, err);
  });
}

// Return the on-disk byte size of a cover file, or null when the cover is
// missing / unreadable / the filename is malformed. Backs the cover_bytes
// column written on every cover_path change in repository.js and the
// startup backfill in db.js.
export function measureCoverBytes(filename) {
  if (!filename) return null;
  if (path.basename(filename) !== filename) return null;
  try {
    return fs.statSync(path.join(UPLOADS_DIR, filename)).size;
  } catch {
    return null;
  }
}

export function deleteLocalCover(filename) {
  if (!filename) return;
  // Defense in depth: refuse to delete anything that isn't a bare filename.
  // toFilename() should already enforce this on the way in, but a stale or
  // hand-edited DB row must not turn a cover replacement into arbitrary
  // file deletion.
  if (path.basename(filename) !== filename) return;
  const abs = path.join(UPLOADS_DIR, filename);
  fs.unlink(abs, (err) => {
    if (err && err.code !== 'ENOENT') console.error(`Failed to delete cover: ${abs}`, err);
  });
  // Companion thumb goes with the original — best-effort, ENOENT swallowed.
  deleteThumbForCover(filename);
}

// Fetch a URL's body for the ISBN cover lookup, or null on any failure or a
// suspiciously small image (Google returns 1×1 placeholders). These URLs are
// server-built (Google Books / Open Library hosts) or come from Google's own
// API response — sometimes plain http — so no SSRF guard or retry here.
async function tryFetchUrl(url) {
  try {
    const response = await fetchOnce(url);
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length >= 2000 ? buf : null;
  } catch { return null; }
}

export async function fetchCoverBuffer(isbn) {
  let buffer = null;

  try {
    const r = await fetchOnce(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    const data = await r.json();
    const links = data.items?.[0]?.volumeInfo?.imageLinks;
    if (links) {
      const raw = links.extraLarge || links.large || links.medium || links.thumbnail;
      if (raw) {
        const url = raw.replace('&edge=curl', '').replace(/zoom=\d+/, 'zoom=0');
        buffer = await tryFetchUrl(url);
      }
    }
  } catch { /* fall through to Open Library */ }

  if (!buffer) buffer = await tryFetchUrl(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`);
  return buffer;
}

export async function saveCoverFromBuffer(buffer) {
  let ext = detectImageExt(buffer);
  if (!ext) throw new Error('Unrecognized image format');
  if (ext === 'webp') {
    buffer = await webpBufferToJpg(buffer);
    ext = 'jpg';
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), buffer);
  // Best-effort thumb — a failure logs and the caller still gets the
  // filename back, so a broken ImageMagick doesn't break uploads.
  await writeThumbForCover(filename, buffer);
  return filename;
}

// Fetch a cover image from an HTTPS URL and save it. Returns the saved
// filename. Throws CoverFetchError carrying an HTTP status so route
// handlers map straight to a response. Used by POST /upload/fetch (the
// caller does the DB update) and POST /books/:id/cover/url (which wires
// save + update so a failed update can clean up the just-saved file).
export class CoverFetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function downloadCoverByUrl(url) {
  // downloadImage applies the SSRF guard (https only; no loopback / LAN /
  // cloud-metadata targets, re-checked on every redirect hop), retries a
  // transient failure once (the OL covers endpoint redirects to
  // archive.org, which is sporadically slow), and enforces image/* and the
  // 10 MB cap.
  let buffer;
  try {
    buffer = await downloadImage(url);
  } catch (err) {
    if (err.clientError) throw new CoverFetchError(err.message, 400);
    // Network failure on both attempts → the OL → archive.org backend is
    // genuinely unreachable; say so, so the user knows it's not Spine. A
    // persistent !ok status stays generic — the upstream is answering,
    // just unhappy.
    throw new CoverFetchError(err.networkFailure
      ? 'Open Library image backend (archive.org) unreachable — try again'
      : 'Failed to fetch cover', 502);
  }
  return saveCoverFromBuffer(buffer);
}
