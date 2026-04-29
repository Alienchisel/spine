const VALID_STATUSES    = ['reading', 'paused', 'finished', 'unread'];
const VALID_FORMATS     = ['physical', 'ebook', 'audiobook'];
const VALID_BINDINGS    = ['paperback', 'hardcover'];
const VALID_CONDITIONS  = ['new', 'fine', 'very good', 'good', 'fair', 'poor'];
const VALID_SOURCE_TYPES = ['primary', 'secondary'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PARTIAL_DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

// Verify that the (y, m, d) tuple is a real calendar date. JS's Date silently
// rolls invalid values forward (e.g. 2024-02-31 → 2024-03-02), so we round-trip
// through Date.UTC and require every component to come back unchanged.
function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidDate(val) {
  if (!DATE_RE.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  return isRealDate(y, m, d);
}

function isValidPartialDate(val) {
  if (!PARTIAL_DATE_RE.test(val)) return false;
  const parts = val.split('-').map(Number);
  if (parts.length === 1) return true;
  const [y, m, d] = parts;
  if (m < 1 || m > 12) return false;
  if (parts.length === 2) return true;
  return isRealDate(y, m, d);
}

export function validateBook(body) {
  const { title, status, format, binding, condition, rating, page_count, duration_minutes, date_started, date_finished, year_published, year_edition, isbn_10, isbn_13 } = body;
  const errors = [];

  if (!title?.trim()) errors.push('Title is required');
  if (title && title.trim().length > 500) errors.push('Title too long');
  if (status && !VALID_STATUSES.includes(status.trim())) errors.push('Invalid status');
  if (format && !VALID_FORMATS.includes(format.trim())) errors.push('Invalid format');
  if (binding && !VALID_BINDINGS.includes(binding.trim())) errors.push('Invalid binding');
  if (condition && !VALID_CONDITIONS.includes(condition.trim())) errors.push('Invalid condition');
  if (body.source_type && !VALID_SOURCE_TYPES.includes(body.source_type.trim())) errors.push('Invalid source type');
  if (rating != null && (Number(rating) < 0.5 || Number(rating) > 5 || (Number(rating) * 2) % 1 !== 0)) errors.push('Rating must be 0.5–5 in half-star increments');
  if (page_count != null && (page_count < 1 || !Number.isInteger(Number(page_count)))) errors.push('Page count must be a positive integer');
  if (duration_minutes != null && (duration_minutes < 1 || !Number.isInteger(Number(duration_minutes)))) errors.push('Duration must be a positive integer');
  if (date_started && !isValidDate(date_started.trim())) errors.push('Invalid date started');
  if (date_finished && !isValidDate(date_finished.trim())) errors.push('Invalid date finished');
  if (body.acquisition_date && !isValidPartialDate(body.acquisition_date.trim())) errors.push('Invalid acquisition date');
  if (year_published != null && (year_published < 1 || !Number.isInteger(Number(year_published)))) errors.push('Invalid publication year');
  if (year_edition != null && (year_edition < 1 || !Number.isInteger(Number(year_edition)))) errors.push('Invalid edition year');
  if (body.series_number != null && isNaN(Number(body.series_number))) errors.push('Invalid series number');
  if (isbn_10 && !/^\d{9}[\dX]$/.test(isbn_10.replace(/[-\s]/g, ''))) errors.push('Invalid ISBN-10');
  if (isbn_13 && !/^\d{13}$/.test(isbn_13.replace(/[-\s]/g, ''))) errors.push('Invalid ISBN-13');
  if (body.asin && !/^[A-Z0-9]{10}$/.test(body.asin.trim().toUpperCase())) errors.push('Invalid ASIN');

  return errors;
}
