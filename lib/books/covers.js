import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

export function deleteLocalCover(filename) {
  if (!filename) return;
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
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
  await sharp(buffer).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 85 }).toFile(path.join(uploadsDir, filename));
  return filename;
}
