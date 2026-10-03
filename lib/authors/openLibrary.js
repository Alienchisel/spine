import { saveAuthorPhotoFromBuffer, deleteAuthorPhoto } from './photos.js';
import { fetchOnce, withRetry, downloadImage } from '../http/fetch.js';

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

// JSON from the Open Library API: one attempt plus one retry on a
// transient failure (lib/http/fetch.js, shared with covers and search).
// The multi-token search endpoints pass ms=15000 — OL's /search index
// routinely spikes past 5 s; without the retry the portrait wizard showed
// 'Search failed' on otherwise-fine queries (Jane Jacobs in particular).
async function getJSON(url, ms = 8000) {
  const res = await withRetry(() => fetchOnce(url, { timeoutMs: ms, accept: 'application/json' }));
  return res.json();
}

// Portrait bytes from covers.openlibrary.org, which redirects to
// archive.org: redirects re-checked through the SSRF guard, one retry on a
// transient failure. A persistent network failure keeps networkFailure so
// the route can name the archive.org backend in its message.
async function getBuffer(url) {
  const res = await withRetry(() => fetchOnce(url, { guardRedirects: true }));
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
// Era markers Open Library uses on ancient authors: "428 BC", "c. 428 BCE",
// "43 B.C.", "March 20, 43 BC", "AD 79", "79 CE". Matched as whole tokens
// (no letter after) so month names like "Dec" can't trip them. A BC/BCE
// year is stored negative; without this, "428 BC" fell through to the
// bare-year fallback and saved Plato's birth as 428 CE, and two-digit BC
// years ("43 B.C.") parsed to nothing.
const BCE_MARKER = /\bB\.?\s*C\.?(?:\s*E\.?)?(?![a-z])/i;
const ERA_MARKERS = /\b(?:B\.?\s*C\.?(?:\s*E\.?)?|A\.?\s*D\.?|C\.?\s*E\.?)(?![a-z])/gi;

const CENTURY = /\b\d+\s*(?:st|nd|rd|th)\s+(?:century|cent\.?|c\.)(?![a-z])/i;

export function parseDate(dateStr) {
  if (!dateStr) return null;
  const raw = String(dateStr).trim();
  // "5th century BC", "1st c. AD": a century is not a year, and with the
  // era marker's short-year allowance the fallback below would read the
  // ordinal as one ("5th century BC" → -5). Leave the date blank instead.
  if (CENTURY.test(raw)) return null;
  const withoutEra = raw.replace(ERA_MARKERS, ' ').replace(/\s+/g, ' ').trim();
  const hasEra = withoutEra !== raw.replace(/\s+/g, ' ').trim();
  const bce = BCE_MARKER.test(raw);
  // With an era marker, short years are real ("43 BC", "AD 79"); drop a
  // leading circa too ("c. 428 BCE"). Without one, keep requiring 3-4
  // digits — OL doesn't emit shortened years and a bare "19" is garbage.
  const str = hasEra ? withoutEra.replace(/^(?:c\.|ca\.|circa)\s*/i, '') : raw;
  const parts = parseDateParts(str, hasEra ? 1 : 3);
  if (!parts) return null;
  const year = bce ? -Math.abs(parts.year) : parts.year;
  return formatYmd(year, parts.month, parts.day);
}

function parseDateParts(str, minYearDigits) {
  const Y = `-?\\d{${minYearDigits},4}`;
  // ISO-ish "YYYY-MM-DD" / "YYYY-MM" / "YYYY" (with optional BCE minus).
  const iso = str.match(new RegExp(`^(${Y})(?:-(\\d{1,2}))?(?:-(\\d{1,2}))?$`));
  if (iso) return { year: +iso[1], month: iso[2] ? +iso[2] : null, day: iso[3] ? +iso[3] : null };
  // "Month D, YYYY" / "Month D YYYY".
  const mdy = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(-?\d{1,4})$/);
  if (mdy) return { year: +mdy[3], month: MONTHS[mdy[1].toLowerCase()] ?? null, day: +mdy[2] };
  // "D Month YYYY".
  const dmy = str.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(-?\d{1,4})$/);
  if (dmy) return { year: +dmy[3], month: MONTHS[dmy[2].toLowerCase()] ?? null, day: +dmy[1] };
  // "Month YYYY".
  const my = str.match(/^([A-Za-z]+),?\s+(-?\d{1,4})$/);
  if (my) return { year: +my[2], month: MONTHS[my[1].toLowerCase()] ?? null, day: null };
  // Fallback — grab any year-shaped number.
  const yr = str.match(new RegExp(`(${Y})`));
  if (yr) return { year: +yr[1], month: null, day: null };
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
// Structured so the repeated group is UNAMBIGUOUS — that's what keeps it
// linear. The three branches are disjoint by leading character (a date
// word starts with a letter, a year with a digit, a separator with
// whitespace/punctuation) and each consumes a deterministic chunk, so any
// input has exactly one tokenization and the engine never backtracks
// across partitions. Two details do the load-bearing work: `\d+(?!\d)`
// makes a digit run atomic (a shorter match is always followed by a digit
// and fails the lookahead, so a run can't be re-split into several \d+
// tokens), and the separator is a single character class rather than a
// `[...]+` run (a `[...]+` nested in the outer `+` is the classic
// `(a+)+` catastrophe). The earlier shape — `\d+` and a standalone-punct
// token inside `(?:\s*DATE_TOK)*` with an empty-matchable separator —
// backtracked exponentially (~19s at 30 digits) on a long digit run
// followed by a non-date char. The separator class carries – (en
// dash) and — (em dash) as explicit escapes alongside the ASCII
// hyphen so the three dash variants are visible to a reviewer.
const DATE_WORD = String.raw`born|died|circa|flourished|ca\.|c\.|fl\.|b\.|d\.|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|BCE|BC|CE|AD`;
const DATE_PAREN_RE = new RegExp(
  String.raw`^([^()]{1,60}?)\s*\(\s*(?:(?:${DATE_WORD})|\d+(?!\d)|[\s.,;\u2013\u2014-])+\s*\)`,
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
// The `?default=false` query param makes OL return 404 when there is
// no real photo (instead of its 1x1 transparent placeholder); the
// picker UI uses <img onError> to hide those tiles so the grid only
// shows actual portraits.
export async function searchAuthorsMulti(name, limit = 8) {
  if (!name || !name.trim()) return [];
  const url = `${SEARCH_URL}?q=${encodeURIComponent(name)}&limit=${limit}`;
  const data = await getJSON(url, 15000);
  const docs = data?.docs || [];
  return docs.map(d => {
    const olKey = (d.key || '').replace(/^\/?(authors\/)?/, '');
    return {
      ol_key:     olKey,
      name:       d.name || null,
      top_work:   d.top_work || null,
      birth_date: d.birth_date || null,
      death_date: d.death_date || null,
      photo_url:  olKey ? `https://covers.openlibrary.org/a/olid/${olKey}-M.jpg?default=false` : null,
    };
  }).filter(c => c.ol_key);
}

// Download a photo by URL and save it via saveAuthorPhotoFromBuffer.
// Returns the local /uploads/authors/... path, or null if OL handed
// back its 1x1 placeholder (handled by the same size threshold as
// downloadAuthorPhoto). Used by the portrait wizard.
export async function downloadAuthorPhotoByUrl(authorId, url) {
  // downloadImage: SSRF guard (https only; no loopback / LAN /
  // cloud-metadata targets, re-checked on every redirect hop — the saved
  // file is retrievable via /uploads, so an unguarded fetch would be an
  // exfil channel), one retry on a transient failure, image/* only and a
  // 10 MB cap enforced while streaming. This path used to have neither the
  // type check nor the cap and read the whole body into memory.
  const buf = await downloadImage(url);
  if (buf.length < 1024) return null;
  return saveAuthorPhotoFromBuffer(authorId, buf);
}

// Top OL match by name. Returns { ol_key } or null when no match.
// OL search ranking is reasonable for canonical authors; gets noisier
// for indie/genre — the caller can decide whether to trust the hit.
export async function searchAuthor(name) {
  if (!name || !name.trim()) return null;
  const url = `${SEARCH_URL}?q=${encodeURIComponent(name)}&limit=5`;
  const data = await getJSON(url, 15000);
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
