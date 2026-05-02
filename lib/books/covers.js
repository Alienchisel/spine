import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

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

async function tryFetchUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length >= 2000 ? buf : null;
  } catch { return null; }
}

export async function fetchCoverBuffer(isbn) {
  let buffer = null;

  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
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
  const ext = detectImageExt(buffer);
  if (!ext) throw new Error('Unrecognized image format');
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir, filename), buffer);
  return filename;
}
