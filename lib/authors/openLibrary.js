import { saveAuthorPhotoFromBuffer, deleteAuthorPhoto } from './photos.js';

// Re-export so existing imports from openLibrary.js keep working.
export { deleteAuthorPhoto };

// Polite Open Library client. We hit two endpoints:
//   - search/authors.json?q=<name>     — top match by OL's own ranking
//   - authors/OL<id>A.json              — bio / dates / photo IDs
// Photos come from covers.openlibrary.org/a/id/<photoId>-L.jpg.
//
// Rate limits: OL doesn't enforce a hard cap but expects polite use. We
// only fetch on first visit to /authors/:id, so the lifetime call count
// is bounded by the number of authors in the library — fine.

const SEARCH_URL  = 'https://openlibrary.org/search/authors.json';
const AUTHOR_BASE = 'https://openlibrary.org/authors';
const PHOTO_BASE  = 'https://covers.openlibrary.org/a/id';
const USER_AGENT  = 'Spine/1.0 (personal library tracker; charlesss@gmail.com)';

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OL ${res.status}: ${url}`);
  return res.json();
}

async function getBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`OL ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// "1938" / "July 18, 1938" / "1938-07-18" all collapse to 1938. OL uses
// inconsistent date formats; we extract the four-digit year and bail
// (return null) on anything we can't parse.
export function parseYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  return year >= 1000 && year <= 2200 ? year : null;
}

// OL bios come as plain strings OR { type: '/type/text', value: '...' }
// — normalize both shapes to a string. Trims trailing whitespace.
export function normalizeBio(bio) {
  if (!bio) return null;
  if (typeof bio === 'string') return bio.trim() || null;
  if (typeof bio === 'object' && typeof bio.value === 'string') return bio.value.trim() || null;
  return null;
}

// Top OL match by name. Returns { ol_key } or null when no match.
// OL search ranking is reasonable for canonical authors; gets noisier
// for indie/genre — the caller can decide whether to trust the hit.
export async function searchAuthor(name) {
  if (!name || !name.trim()) return null;
  const url = `${SEARCH_URL}?q=${encodeURIComponent(name)}&limit=5`;
  const data = await getJSON(url);
  const docs = data?.docs || [];
  // Prefer an exact case-insensitive name match in the top results
  // before falling back to OL's ranking — protects against "John
  // Norman" returning a different John Norman as #1 when our author
  // is also there at #2.
  const exact = docs.find(d => (d.name || '').toLowerCase() === name.toLowerCase());
  const pick = exact || docs[0];
  if (!pick?.key) return null;
  // OL search returns the bare id (e.g. "OL23914A"); the detail
  // endpoint accepts the same form. Strip any leading slash defensively.
  const olKey = pick.key.replace(/^\/?(authors\/)?/, '');
  return { ol_key: olKey };
}

// Author detail by OL key. Returns the fields we care about — bio,
// birth/death years, first photo id. Missing fields stay null.
export async function fetchAuthorDetails(olKey) {
  const url = `${AUTHOR_BASE}/${olKey}.json`;
  const data = await getJSON(url);
  return {
    bio:        normalizeBio(data.bio),
    birth_year: parseYear(data.birth_date),
    death_year: parseYear(data.death_date),
    photo_id:   Array.isArray(data.photos) ? data.photos.find(p => p && p > 0) ?? null : null,
  };
}

// Download a photo by OL id and save it locally. Returns a URL-relative
// path (`/uploads/authors/<file>`) ready to write straight into
// authors.photo_path, or null if OL returned its 1x1 placeholder
// (which is OL's way of saying "no photo on file" even though the id
// exists).
export async function downloadAuthorPhoto(authorId, photoId) {
  const buf = await getBuffer(`${PHOTO_BASE}/${photoId}-L.jpg`);
  if (buf.length < 1024) return null;
  return saveAuthorPhotoFromBuffer(authorId, buf);
}

// Compose the full lookup: search → details → photo. Returns the
// fields ready to UPDATE authors with. Returns null if no OL match.
// Callers handle the null case as "skeleton page, no data".
export async function lookupAuthor(name, authorId) {
  const found = await searchAuthor(name);
  if (!found?.ol_key) return null;
  const details = await fetchAuthorDetails(found.ol_key);
  let photo_path = null;
  if (details.photo_id) {
    try {
      photo_path = await downloadAuthorPhoto(authorId, details.photo_id);
    } catch {
      // Photo download failed; keep bio/dates and let UI skeleton the
      // portrait. Don't fail the whole refresh.
    }
  }
  return {
    ol_key:     found.ol_key,
    bio:        details.bio,
    birth_year: details.birth_year,
    death_year: details.death_year,
    photo_path,
  };
}
