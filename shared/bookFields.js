// Single source of truth for what fields a book has and what default value
// the form uses for each. Used by the BookForm to seed and coerce state.
// Adding a field should require touching this file plus a render site — not five.

// Integer-valued fields edited via <input type="number">. Form holds them as
// strings ('' when blank) and they are parseInt'd on submit.
export const INTEGER_FIELDS = Object.freeze([
  'page_count', 'duration_minutes',
  'year_published', 'year_edition',
]);

// Float-valued field. Same form behaviour as integers but parseFloat on submit.
export const FLOAT_FIELDS = Object.freeze(['series_number']);

// Default form state. Values are chosen to make the BookForm render cleanly
// for a fresh book; see comments per group for the rationale.
export const FORM_DEFAULTS = Object.freeze({
  // Scalar strings — '' when blank.
  title: '', description: '', notes: '', review: '',
  publisher: '', series: '', acquisition_source: '',
  original_language: '',
  isbn_10: '', isbn_13: '', asin: '',
  // Enums — '' = unset, except status which always has a value.
  status: 'unread', format: '', binding: '', condition: '', source_type: '',
  // Special: language defaults to English (most common case).
  language: 'English',

  // Booleans.
  owned: false, previously_owned: false, is_custom: false, is_stub: false,
  loved: false, year_approximate: false, abridged: false, archived: false,

  // Tri-state.
  fiction: null,

  // Integer/float number inputs render '' when blank.
  page_count: '', duration_minutes: '',
  year_published: '', year_edition: '',
  series_number: '',

  // Counter (always a Number).
  read_count: 0,

  // Rating widget — null = unrated.
  rating: null,

  // Dates — '' when blank.
  date_started: '', date_finished: '', acquisition_date: '',

  // Location IDs — null when not assigned.
  shelf_id: null, building_id: null, room_id: null, unit_id: null,

  // Joined arrays — empty by default.
  authors: [], narrators: [], translators: [], tags: [],

  // Cover path.
  cover_path: null,
});

// Virtual tags computed from book fields (never stored). The frontend uses
// this list to filter out virtual names from past-tag suggestions.
// Keep in sync with VIRTUAL_TAG_RULES in lib/books/filters.js.
export const VIRTUAL_TAG_NAMES = Object.freeze(['Antique', 'Vintage', 'Translated', 'Re-read', 'Abridged', 'Long', 'Short']);

// Valid values for each enum field. Single source of truth for both backend
// validation and the form's <select> options.
export const ENUM_VALUES = Object.freeze({
  status:      ['reading', 'finished', 'unread'],
  format:      ['physical', 'ebook', 'audiobook'],
  binding:     ['paperback', 'hardcover'],
  condition:   ['new', 'fine', 'very good', 'good', 'fair', 'poor'],
  source_type: ['primary', 'secondary'],
});

// Columns on the books table that POST and full-replace PUT write to.
// Excludes current_page / current_minutes (PATCH-only via reading_log) and
// read_count (own update rules — see docs/book-model.md § Reading data rules).
// repository.js derives BOOK_INSERT_COLS and BOOK_UPDATE_COLS from this list,
// and a startup check verifies bookColumns() supplies a value for every entry.
export const BOOK_TABLE_COLUMNS = Object.freeze([
  'title', 'status', 'owned', 'previously_owned', 'is_custom', 'is_stub', 'loved',
  'fiction', 'source_type', 'cover_path', 'rating',
  'date_started', 'date_finished', 'acquisition_source', 'acquisition_date',
  'format', 'binding', 'condition',
  'description', 'notes', 'review',
  'page_count', 'duration_minutes',
  'publisher', 'series', 'series_number',
  'isbn_10', 'isbn_13', 'asin',
  'language', 'original_language',
  'year_published', 'year_approximate', 'year_edition',
  'abridged',
  'archived',
  'shelf_id', 'building_id', 'room_id', 'unit_id',
]);
