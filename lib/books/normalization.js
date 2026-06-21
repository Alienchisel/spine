// Strip a single layer of matched surrounding quotes ('X' / "X" → X).
// Protects against ingest scripts that paste a Python repr() or shell-
// quoted string into a free-text field — the 2026-06-06 incident where
// three books arrived with authors stored as "'Simplicius'" (literal
// quotes around the name) sorted them ahead of "Aeneas" because the '
// character is below all letters in ASCII. Mid-string quotes are
// untouched (s[0] !== s[s.length-1]), so "'tis…" and '"Stonewall" Jackson'
// are safe.
export function stripWrap(s) {
  if (typeof s !== 'string' || s.length < 2) return s;
  const a = s[0], b = s[s.length - 1];
  if ((a === "'" || a === '"') && a === b) return s.slice(1, -1).trim();
  return s;
}

// Fold hyphen-shaped Unicode characters into the ASCII hyphen so search
// stays predictable. Publisher and Amazon metadata routinely paste
// non-breaking hyphens (U+2011) into compound titles like "Three‑Body
// Problem" — visually indistinguishable from a hyphen but unreachable
// by a Ctrl-K query for "Three-Body". Same story for the en-dash in
// date ranges ("1929–1964"). The em-dash (U+2014) is left alone —
// it's visually distinct, used at sentence level, and rarely searched
// against. Soft hyphen is an invisible line-break hint; drop it
// entirely.
// U+2010 HYPHEN, U+2011 NON-BREAKING HYPHEN, U+2012 FIGURE DASH,
// U+2013 EN DASH, U+2212 MINUS SIGN — all visually hyphen-ish; fold
// to ASCII '-'. U+00AD SOFT HYPHEN is an invisible line-break hint;
// drop it. Em-dash (U+2014) is deliberately left alone — visually
// distinct, used at sentence level, rarely searched against.
export function foldExoticHyphens(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/[‐‑‒–−]/g, '-')
    .replace(/­/g, '');
}

// Trim + unwrap, for identifier/name-like fields (title, publisher, series,
// language, asin, source_type, acquisition_source, date strings, plus the
// people/tag name pipelines via stripWrap in their own modules). Returns
// null for empty/whitespace input so empty strings collapse to NULL columns.
export function t(val) {
  if (val == null) return null;
  const s = foldExoticHyphens(stripWrap(String(val).trim()));
  return s || null;
}

// Prose counterpart: trim only, no unwrap. For description / notes / review
// — long-form fields where a legitimate body can start and end with the
// same quote character (a quoted opening sentence, a single-word review
// like '"meh."') and unwrap would silently lose content.
export function tProse(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

export function normalizeIsbn(val) {
  if (!val) return null;
  const clean = val.trim().replace(/[-\s]/g, '');
  return clean || null;
}

// Convert an API cover_path (e.g. "/uploads/1709876543210-abc123.jpg") into
// the bare filename stored in the DB. Shape is locked to the form that
// saveCoverFromBuffer() in lib/books/covers.js produces —
// `${Date.now()}-${random base36}.${ext}` — across the image extensions we
// accept on upload. Anything else (including '.', '..', subpaths, or
// uppercase variants) is dropped to null.
const SAFE_COVER_FILENAME = /^\d+-[A-Za-z0-9]+\.(webp|jpe?g|png|gif)$/;

export function toFilename(coverPath) {
  if (!coverPath) return null;
  if (!coverPath.startsWith('/uploads/')) return null;
  const filename = coverPath.slice('/uploads/'.length);
  return SAFE_COVER_FILENAME.test(filename) ? filename : null;
}

export function toCoverUrl(filename) {
  return filename ? `/uploads/${filename}` : null;
}

// Most-specific level wins; all less-specific fields are forced to null.
// Physical hierarchy (most → least specific): shelf > unit > room > building.
export function normalizeBookLocation({ shelf_id, unit_id, room_id, building_id } = {}) {
  const s = shelf_id    || null;
  const u = unit_id     || null;
  const r = room_id     || null;
  const b = building_id || null;
  if (s) return { shelf_id: s, unit_id: null,  room_id: null,  building_id: null };
  if (u) return { shelf_id: null, unit_id: u,  room_id: null,  building_id: null };
  if (r) return { shelf_id: null, unit_id: null, room_id: r,   building_id: null };
  return  { shelf_id: null, unit_id: null, room_id: null, building_id: b };
}
