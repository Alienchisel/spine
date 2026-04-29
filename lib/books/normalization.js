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
