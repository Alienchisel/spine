import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// User dislikes WebP (see memory feedback_no_webp_covers.md). When a WebP
// buffer arrives — from a direct upload or a fetched URL — pipe it through
// ImageMagick `convert` to JPG before writing. Requires `convert` on PATH.
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

// Magic-byte sniff — used when we don't have a reliable Content-Type
// (the ISBN auto-fetch path drops it after the buffer is in hand). Returns
// one of the extensions allowed by SAFE_COVER_FILENAME, or null.
export function detectImageExt(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function deleteLocalCover(filename) {
  if (!filename) return;
  // Defense in depth: refuse to delete anything that isn't a bare filename.
  // toFilename() should already enforce this on the way in, but a stale or
  // hand-edited DB row must not turn a cover replacement into arbitrary
  // file deletion.
  if (path.basename(filename) !== filename) return;
  const abs = path.join(uploadsDir, filename);
  fs.unlink(abs, (err) => {
    if (err && err.code !== 'ENOENT') console.error(`Failed to delete cover: ${abs}`, err);
  });
}

// Open Library returns 403 to the default node-fetch User-Agent; identify
// ourselves so the cover-fetch fallback (covers.openlibrary.org) can work.
// Google Books accepts anonymous requests but a polite UA doesn't hurt.
const OL_USER_AGENT = 'Spine/1.0 (personal library tracker; charlesss@gmail.com)';

function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    signal: controller.signal,
    headers: { 'User-Agent': OL_USER_AGENT },
  }).finally(() => clearTimeout(timer));
}

async function tryFetchUrl(url) {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length >= 2000 ? buf : null;
  } catch { return null; }
}

export async function fetchCoverBuffer(isbn) {
  let buffer = null;

  try {
    const r = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
    if (r.ok) {
      const data = await r.json();
      const links = data.items?.[0]?.volumeInfo?.imageLinks;
      if (links) {
        const raw = links.extraLarge || links.large || links.medium || links.thumbnail;
        if (raw) {
          const url = raw.replace('&edge=curl', '').replace(/zoom=\d+/, 'zoom=0');
          buffer = await tryFetchUrl(url);
        }
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
  await fs.promises.writeFile(path.join(uploadsDir, filename), buffer);
  return filename;
}

// Fetch a cover image from an HTTPS URL, validate size/content-type, and
// save it via saveCoverFromBuffer. Returns the saved filename. Throws on
// validation failures with a CoverFetchError carrying an HTTP status code
// so route handlers can map back to a 4xx/5xx response. Used by both the
// /upload/fetch endpoint (where the caller does the DB update separately)
// and the combined POST /api/books/:id/cover/url endpoint (where the
// caller wires save+update together so failed updates can clean up the
// just-saved file).
export class CoverFetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// One timed fetch attempt. Returns the Response or throws — the caller
// decides whether to retry. We treat AbortError (timeout) and TypeError
// (Node fetch surfaces TCP-level failures this way: ECONNRESET, ENOTFOUND,
// connect timeout) as transient. Status-code triage happens here too: 5xx
// and 429 are transient; 4xx (other than 429) are not.
async function fetchCoverOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': OL_USER_AGENT },
    });
  } catch (err) {
    // AbortError (our timeout) and TypeError (TCP failure) → transient,
    // and distinct from a !ok HTTP status: a connect timeout means the
    // OL→archive.org redirect couldn't be followed at all, which is the
    // archive.org-flake case worth surfacing specifically.
    const transient = err?.name === 'AbortError' || err instanceof TypeError;
    const e = new Error(err?.message || 'Network error');
    e.transient = transient;
    e.networkFailure = transient;
    throw e;
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const e = new Error(`Upstream returned ${response.status}`);
    e.transient = response.status === 429 || (response.status >= 500 && response.status < 600);
    e.networkFailure = false;
    e.status = response.status;
    throw e;
  }
  return response;
}

export async function downloadCoverByUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new CoverFetchError('Invalid URL', 400); }
  if (parsed.protocol !== 'https:') throw new CoverFetchError('Only HTTPS URLs are allowed', 400);

  // Retry once on transient failures. The OL covers endpoint redirects to
  // archive.org for the actual image, and archive.org is sporadically slow
  // / refuses connections under load — a single retry after a short delay
  // absorbs nearly all of those flakes without surfacing them to the user.
  // Persistent failure → upstream really is down, surface a specific error
  // so the user knows it's not Spine misbehaving.
  let response;
  try {
    response = await fetchCoverOnce(url);
  } catch (err) {
    if (!err.transient) {
      throw new CoverFetchError('Failed to fetch cover', 502);
    }
    await new Promise(r => setTimeout(r, 300));
    try {
      response = await fetchCoverOnce(url);
    } catch (retryErr) {
      // Network failure on both attempts → the OL→archive.org backend is
      // genuinely unreachable (sporadic TCP refusal is the common shape).
      // Surface that specifically so the user knows it's not Spine. A
      // persistent !ok HTTP status from upstream stays on the generic
      // message — the upstream is responding, just unhappy.
      const msg = retryErr.networkFailure
        ? 'Open Library image backend (archive.org) unreachable — try again'
        : 'Failed to fetch cover';
      throw new CoverFetchError(msg, 502);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new CoverFetchError('URL does not point to an image', 400);
  const contentLength = parseInt(response.headers.get('content-length') || '0');
  if (contentLength > 10 * 1024 * 1024) throw new CoverFetchError('Image too large', 400);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 10 * 1024 * 1024) throw new CoverFetchError('Image too large', 400);
  return saveCoverFromBuffer(buffer);
}
