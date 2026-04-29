export function t(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

export function normalizeIsbn(val) {
  if (!val) return null;
  const clean = val.trim().replace(/[-\s]/g, '');
  return clean || null;
}

// Convert an API cover_path (e.g. "/uploads/abc.webp") into the bare filename
// stored in the DB. Rejects anything that isn't a server-generated upload —
// crucially, anything containing path separators or '..' that could later
// escape uploads/ via path.join() in deleteLocalCover().
const SAFE_COVER_FILENAME = /^[A-Za-z0-9._-]+$/;

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
