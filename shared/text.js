// Search-text folding shared by the server (db.js registers it as the
// SQLite nrm() function used on both sides of every search LIKE) and the
// client (index filters, command palette). One implementation, so the
// two can't drift — the palette used to only lowercase, so `author:bohm`
// missed Böhm-Bawerk while the server search found it.
//
// nrm(text): lowercase + strip combining diacritics + fold a handful of
// non-decomposing ligatures (æ→ae, œ→oe, ß→ss, ø→o, ð→d, þ→th, ł→l, đ→d)
// + collapse typographic look-alikes to their ASCII equivalents:
// curly quotes → ' ", exotic hyphens including em-dash → -, ellipsis →
// "...". Soft hyphen (U+00AD) is dropped.
//
// Used by the search-bar LIKE clauses on both sides of the comparison
// so a query for "thermae romae" matches stored "Thermæ Rōmæ", "café"
// matches "cafe", "Stanislaw Lem" matches "Stanisław Lem", "Albion's
// Seed" (curly apostrophe from a copy-paste) matches stored "Albion's
// Seed", and typing a title with an em-dash or ellipsis still finds
// the same title stored with a plain hyphen or three periods (or vice
// versa). Ingest's t() folds en-dash / figure-dash / minus but leaves
// em-dash and ellipsis alone for display fidelity, so nrm() has to
// fold *all* the look-alikes on the search side to keep both
// directions symmetric — the 2026-07-10 sweep uncovered a real miss
// on Albion's Seed (curly apostrophe) plus latent en-dash → hyphen,
// em-dash ↔ hyphen, and ellipsis ↔ "..." misses. Cheap enough to run
// per-row at query time — the LIKE is already non-indexable due to
// the leading wildcard. The Slavic ł / đ pair is included because
// NFD does NOT decompose them (the slash on 'ł' is part of the base
// character, not a combining mark).
export function nrm(s) {
  if (s == null) return null;
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/ø/g, 'o').replace(/ð/g, 'd').replace(/þ/g, 'th')
    .replace(/ł/g, 'l').replace(/đ/g, 'd')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/\u00AD/g, '')
    .replace(/\u2026/g, '...');
}
