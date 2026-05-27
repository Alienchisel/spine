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

// OL date strings come in three common shapes — "1938", "1938-07-18",
// and "July 18, 1938" (sometimes "18 July 1938"). Parse all of them
// into our canonical TEXT format: "YYYY", "YYYY-MM", or "YYYY-MM-DD".
// Returns null when no recognizable year is present.
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
function formatYmd(year, month, day) {
  if (!Number.isInteger(year) || year < -3000 || year > 2200) return null;
  let s = String(year);
  if (Number.isInteger(month) && month >= 1 && month <= 12) {
    s += `-${String(month).padStart(2, '0')}`;
    if (Number.isInteger(day) && day >= 1 && day <= 31) {
      s += `-${String(day).padStart(2, '0')}`;
    }
  }
  return s;
}
export function parseDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  // ISO-ish "YYYY-MM-DD" / "YYYY-MM" / "YYYY" (with optional BCE minus).
  // Require 3-4 digit years to avoid grabbing 2-digit strays — OL doesn't
  // emit shortened years and a bare "19" is almost certainly garbage.
  const iso = str.match(/^(-?\d{3,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (iso) return formatYmd(+iso[1], iso[2] ? +iso[2] : null, iso[3] ? +iso[3] : null);
  // "Month D, YYYY" / "Month D YYYY".
  const mdy = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(-?\d{1,4})$/);
  if (mdy) return formatYmd(+mdy[3], MONTHS[mdy[1].toLowerCase()] ?? null, +mdy[2]);
  // "D Month YYYY".
  const dmy = str.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(-?\d{1,4})$/);
  if (dmy) return formatYmd(+dmy[3], MONTHS[dmy[2].toLowerCase()] ?? null, +dmy[1]);
  // "Month YYYY".
  const my = str.match(/^([A-Za-z]+),?\s+(-?\d{1,4})$/);
  if (my) return formatYmd(+my[2], MONTHS[my[1].toLowerCase()] ?? null, null);
  // Fallback — grab any 3-4 digit year-shaped number.
  const yr = str.match(/(-?\d{3,4})/);
  if (yr) return formatYmd(+yr[1], null, null);
  return null;
}

// OL bios come as plain strings OR { type: '/type/text', value: '...' }
// — normalize both shapes to a string. Trims trailing whitespace.
export function normalizeBio(bio) {
  if (!bio) return null;
  if (typeof bio === 'string') return bio.trim() || null;
  if (typeof bio === 'object' && typeof bio.value === 'string') return bio.value.trim() || null;
  return null;
}

// Strip the leading date parenthetical from an OL bio — birth/death
// years already show on the page meta line, so "Smith (1850–1920) was…"
// just duplicates the dates. The match is anchored to within the first
// 60 chars (i.e. immediately after the author name), so mid-bio book
// publication dates like "(1973)" and any other legitimate year refs
// downstream survive. The paren contents must consist only of date-like
// tokens — years, ranges, born/died/circa prefixes, day numerals, month
// names, BCE/AD markers — so non-date parens like "(commonly known as
// X)" or "(with Larry Niven)" are preserved.
const DATE_TOK = String.raw`(?:b\.|d\.|born|died|c\.|ca\.|circa|fl\.|flourished|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|BCE|BC|CE|AD|\d+|[-–—.,;])`;
const DATE_PAREN_RE = new RegExp(
  String.raw`^([^()]{1,60}?)\s*\(\s*${DATE_TOK}(?:\s*${DATE_TOK})*\s*\)`,
  'i',
);
export function stripBioDates(bio) {
  if (!bio) return bio;
  const cleaned = bio.replace(DATE_PAREN_RE, '$1').replace(/\s{2,}/g, ' ');
  return cleaned.trim() || null;
}

// Multi-candidate OL search by name. Returns up to `limit` candidates
// with the bits the portrait wizard needs: ol_key, name, top_work,
// birth_date, death_date, and a photo URL derived from the ol_key.
// OL serves a 1x1 placeholder for authors without a real photo — we
// pass that through; the picker UI lets the user see which thumbnails
// resolved to real images. Defensive against missing fields.
export async function searchAuthorsMulti(name, limit = 8) {
  if (!name || !name.trim()) return [];
  const url = `${SEARCH_URL}?q=${encodeURIComponent(name)}&limit=${limit}`;
  const data = await getJSON(url);
  const docs = data?.docs || [];
  return docs.map(d => {
    const olKey = (d.key || '').replace(/^\/?(authors\/)?/, '');
    return {
      ol_key:     olKey,
      name:       d.name || null,
      top_work:   d.top_work || null,
      birth_date: d.birth_date || null,
      death_date: d.death_date || null,
      photo_url:  olKey ? `https://covers.openlibrary.org/a/olid/${olKey}-M.jpg` : null,
    };
  }).filter(c => c.ol_key);
}

// Download a photo by URL and save it via saveAuthorPhotoFromBuffer.
// Returns the local /uploads/authors/... path, or null if OL handed
// back its 1x1 placeholder (handled by the same size threshold as
// downloadAuthorPhoto). Used by the portrait wizard.
export async function downloadAuthorPhotoByUrl(authorId, url) {
  const buf = await getBuffer(url);
  if (buf.length < 1024) return null;
  return saveAuthorPhotoFromBuffer(authorId, buf);
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
    bio:        stripBioDates(normalizeBio(data.bio)),
    birth_date: parseDate(data.birth_date),
    death_date: parseDate(data.death_date),
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
    birth_date: details.birth_date,
    death_date: details.death_date,
    photo_path,
  };
}
