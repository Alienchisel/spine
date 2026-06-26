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

// Errors are pushed as { message, field } so the route layer can echo the
// originating field back to the client for tab-switching / inline highlighting.
// Consumers that only want the strings can `.map(e => e.message)`.
export function validateBook(body) {
  const errors = [];
  const push = (message, field) => errors.push({ message, field });

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
    else push('isbn must be 10 or 13 digits — use isbn_10 / isbn_13 explicitly for non-standard values', 'isbn');
  }

  const { title, status, format, binding, condition, rating, page_count, duration_minutes, date_started, date_finished, year_published, year_edition, isbn_10, isbn_13 } = body;

  if (!title?.trim()) push('Title is required', 'title');
  if (title && title.trim().length > 500) push('Title too long', 'title');
  if (status && !ENUM_VALUES.status.includes(status.trim())) push('Invalid status', 'status');
  if (format && !ENUM_VALUES.format.includes(format.trim())) push('Invalid format', 'format');
  if (binding && !ENUM_VALUES.binding.includes(binding.trim())) push('Invalid binding', 'binding');
  if (condition && !ENUM_VALUES.condition.includes(condition.trim())) push('Invalid condition', 'condition');
  if (body.source_type && !ENUM_VALUES.source_type.includes(body.source_type.trim())) push('Invalid source type', 'source_type');
  // source_type is non-fiction-only; the column is gated on fiction === 0
  // in repository.js. Reject loudly here instead of silently nulling the
  // field, otherwise an API caller setting source_type without setting
  // fiction sees the field dropped on save with no explanation.
  if (body.source_type) {
    const f = body.fiction;
    const isNonFiction = f === false || f === 0 || f === '0';
    if (!isNonFiction) push('source_type requires fiction: false', 'source_type');
  }
  if (rating != null && (Number(rating) < 0.5 || Number(rating) > 5 || (Number(rating) * 2) % 1 !== 0)) push('Rating must be 0.5–5 in half-star increments', 'rating');
  if (page_count != null && (page_count < 1 || !Number.isInteger(Number(page_count)))) push('Page count must be a positive integer', 'page_count');
  if (duration_minutes != null && (duration_minutes < 1 || !Number.isInteger(Number(duration_minutes)))) push('Duration must be a positive integer', 'duration_minutes');
  // Partial dates (YYYY / YYYY-MM / YYYY-MM-DD) are accepted on the book row's
  // start/finish columns — matches reads / stories / acquisition_date so the
  // rule is uniform: anywhere a date can be remembered vaguely, the system
  // takes a vague date. Stats queries that use strftime/julianday silently
  // exclude partial-date rows (defensible — a vague memory can't contribute
  // to year-buckets or days-to-read averages); see lib/stats/activity.js.
  if (date_started && !isValidPartialDate(date_started.trim())) push('Invalid date started', 'date_started');
  if (date_finished && !isValidPartialDate(date_finished.trim())) push('Invalid date finished', 'date_finished');
  if (body.acquisition_date && !isValidPartialDate(body.acquisition_date.trim())) push('Invalid acquisition date', 'acquisition_date');
  // Negatives represent BCE (e.g. -800 = 8th century BCE Homer); year 0 doesn't exist on the proleptic calendar.
  if (year_published != null && (!Number.isInteger(Number(year_published)) || Number(year_published) === 0)) push('Invalid publication year', 'year_published');
  if (year_edition   != null && (!Number.isInteger(Number(year_edition))   || Number(year_edition)   === 0)) push('Invalid edition year', 'year_edition');
  if (body.series_number != null && body.series_number !== '') {
    const n = Number(body.series_number);
    if (isNaN(n)) push('Invalid series number', 'series_number');
    // Series numbering is whole or half-volume only (1, 1.5, 2, …). Reject
    // 1.1 / 1.7 / etc.; volume.issue listings store the volume integer.
    else if ((n * 2) % 1 !== 0) push('Series number must be a multiple of 0.5', 'series_number');
  }
  if (body.read_count != null && (Number(body.read_count) < 0 || !Number.isInteger(Number(body.read_count)))) push('read_count must be a non-negative integer', 'read_count');
  if (isbn_10 && !/^\d{9}[\dX]$/.test(isbn_10.replace(/[-\s]/g, ''))) push('Invalid ISBN-10', 'isbn_10');
  if (isbn_13 && !/^\d{13}$/.test(isbn_13.replace(/[-\s]/g, ''))) push('Invalid ISBN-13', 'isbn_13');
  if (body.asin && !/^[A-Z0-9]{10}$/.test(body.asin.trim().toUpperCase())) push('Invalid ASIN', 'asin');

  return errors;
}
