import { ENUM_VALUES } from '../../shared/bookFields.js';

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

export function isValidPartialDate(val) {
  if (!PARTIAL_DATE_RE.test(val)) return false;
  const parts = val.split('-').map(Number);
  if (parts.length === 1) return true;
  const [y, m, d] = parts;
  if (m < 1 || m > 12) return false;
  if (parts.length === 2) return true;
  return isRealDate(y, m, d);
}

// Compare partial dates of possibly-different precision. Truncating both to the
// shared prefix lets year-only and year-month dates coexist with full ISO without
// the lexical false-positive where `'2024' < '2024-06'` is true.
// Pre: both args are non-empty isValidPartialDate strings.
export function partialDateBefore(a, b) {
  const n = Math.min(a.length, b.length);
  return a.slice(0, n) < b.slice(0, n);
}

export function validateBook(body) {
  const errors = [];

  // Accept a generic `isbn` field by routing it to the typed slot based
  // on length. Humans (and most listing pages) speak of "the ISBN"
  // without distinguishing 10 vs 13; without this, a POST carrying
  // `isbn: "9781614876434"` was silently dropped because validation
  // and the column writer both read `isbn_10` / `isbn_13` only.
  // Mutates body so downstream normalization sees the resolved field.
  if (body.isbn && !body.isbn_10 && !body.isbn_13) {
    const stripped = String(body.isbn).replace(/[-\s]/g, '');
    if      (stripped.length === 13) body.isbn_13 = body.isbn;
    else if (stripped.length === 10) body.isbn_10 = body.isbn;
    else errors.push('isbn must be 10 or 13 digits — use isbn_10 / isbn_13 explicitly for non-standard values');
  }

  const { title, status, format, binding, condition, rating, page_count, duration_minutes, date_started, date_finished, year_published, year_edition, isbn_10, isbn_13 } = body;

  if (!title?.trim()) errors.push('Title is required');
  if (title && title.trim().length > 500) errors.push('Title too long');
  if (status && !ENUM_VALUES.status.includes(status.trim())) errors.push('Invalid status');
  if (format && !ENUM_VALUES.format.includes(format.trim())) errors.push('Invalid format');
  if (binding && !ENUM_VALUES.binding.includes(binding.trim())) errors.push('Invalid binding');
  if (condition && !ENUM_VALUES.condition.includes(condition.trim())) errors.push('Invalid condition');
  if (body.source_type && !ENUM_VALUES.source_type.includes(body.source_type.trim())) errors.push('Invalid source type');
  // source_type is non-fiction-only; the column is gated on fiction === 0
  // in repository.js. Reject loudly here instead of silently nulling the
  // field, otherwise an API caller setting source_type without setting
  // fiction sees the field dropped on save with no explanation.
  if (body.source_type) {
    const f = body.fiction;
    const isNonFiction = f === false || f === 0 || f === '0';
    if (!isNonFiction) errors.push('source_type requires fiction: false');
  }
  if (rating != null && (Number(rating) < 0.5 || Number(rating) > 5 || (Number(rating) * 2) % 1 !== 0)) errors.push('Rating must be 0.5–5 in half-star increments');
  if (page_count != null && (page_count < 1 || !Number.isInteger(Number(page_count)))) errors.push('Page count must be a positive integer');
  if (duration_minutes != null && (duration_minutes < 1 || !Number.isInteger(Number(duration_minutes)))) errors.push('Duration must be a positive integer');
  if (date_started && !isValidDate(date_started.trim())) errors.push('Invalid date started');
  if (date_finished && !isValidDate(date_finished.trim())) errors.push('Invalid date finished');
  if (body.acquisition_date && !isValidPartialDate(body.acquisition_date.trim())) errors.push('Invalid acquisition date');
  // Negatives represent BCE (e.g. -800 = 8th century BCE Homer); year 0 doesn't exist on the proleptic calendar.
  if (year_published != null && (!Number.isInteger(Number(year_published)) || Number(year_published) === 0)) errors.push('Invalid publication year');
  if (year_edition   != null && (!Number.isInteger(Number(year_edition))   || Number(year_edition)   === 0)) errors.push('Invalid edition year');
  if (body.series_number != null && isNaN(Number(body.series_number))) errors.push('Invalid series number');
  if (body.read_count != null && (Number(body.read_count) < 0 || !Number.isInteger(Number(body.read_count)))) errors.push('read_count must be a non-negative integer');
  if (isbn_10 && !/^\d{9}[\dX]$/.test(isbn_10.replace(/[-\s]/g, ''))) errors.push('Invalid ISBN-10');
  if (isbn_13 && !/^\d{13}$/.test(isbn_13.replace(/[-\s]/g, ''))) errors.push('Invalid ISBN-13');
  if (body.asin && !/^[A-Z0-9]{10}$/.test(body.asin.trim().toUpperCase())) errors.push('Invalid ASIN');

  return errors;
}
