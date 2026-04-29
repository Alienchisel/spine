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

export function toFilename(coverPath) {
  if (!coverPath) return null;
  return coverPath.startsWith('/uploads/') ? coverPath.slice('/uploads/'.length) : coverPath;
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
