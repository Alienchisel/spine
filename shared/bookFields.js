// Single source of truth for what fields a book has, how they're typed, and
// what default value the form uses for each. Used by the BookForm to seed and
// coerce state, and (in time) by route validation. Adding a field should
// require touching this file plus a render site — not five.

// Free-text strings and enums. No payload coercion needed; backend t() trims
// and converts blanks to NULL.
export const SCALAR_FIELDS = [
  'title', 'description', 'notes', 'review',
  'publisher', 'series', 'translator', 'acquisition_source',
  'language', 'original_language',
  'isbn_10', 'isbn_13', 'asin',
  'status', 'format', 'binding', 'condition', 'source_type',
];

// Stored as 0/1 in the DB. Form holds them as JS booleans.
export const BOOLEAN_FIELDS = [
  'owned', 'previously_owned', 'is_custom', 'is_stub', 'loved', 'year_approximate',
];

// Three-way: null | true | false. Stored as NULL/0/1.
export const TRISTATE_FIELDS = ['fiction'];

// Integer-valued fields edited via <input type="number">. Form holds them as
// strings ('' when blank) and they are parseInt'd on submit.
export const INTEGER_FIELDS = [
  'page_count', 'duration_minutes', 'current_page',
  'year_published', 'year_edition',
];

// Float-valued field. Same form behaviour as integers but parseFloat on submit.
export const FLOAT_FIELDS = ['series_number'];

// Always-Number counter (defaults to 0, never blank).
export const COUNTER_FIELDS = ['read_count'];

// Rating uses the StarRating widget: null = unrated, otherwise 0.5–5 in 0.5 steps.
export const RATING_FIELDS = ['rating'];

// Date strings — full ISO 'YYYY-MM-DD' or partial 'YYYY' / 'YYYY-MM' for
// acquisition_date.
export const DATE_FIELDS = ['date_started', 'date_finished', 'acquisition_date'];

// FK-style integer IDs. Only one location level is kept; see
// normalizeBookLocation() in lib/books/normalization.js.
export const LOCATION_FIELDS = ['shelf_id', 'building_id', 'room_id', 'unit_id'];

// Joined many-to-many string arrays. Synced via separate join tables on save.
export const JOINED_FIELDS = ['authors', 'narrators', 'tags'];

// Cover path — bare filename in the DB, '/uploads/'-prefixed in API responses.
export const COVER_FIELDS = ['cover_path'];

// Default form state. Values are chosen to make the BookForm render cleanly
// for a fresh book; see comments per group for the rationale.
export const FORM_DEFAULTS = Object.freeze({
  // Scalar strings — '' when blank.
  title: '', description: '', notes: '', review: '',
  publisher: '', series: '', translator: '', acquisition_source: '',
  original_language: '',
  isbn_10: '', isbn_13: '', asin: '',
  // Enums — '' = unset, except status which always has a value.
  status: 'unread', format: '', binding: '', condition: '', source_type: '',
  // Special: language defaults to English (most common case).
  language: 'English',

  // Booleans.
  owned: false, previously_owned: false, is_custom: false, is_stub: false,
  loved: false, year_approximate: false,

  // Tri-state.
  fiction: null,

  // Integer/float number inputs render '' when blank.
  page_count: '', duration_minutes: '', current_page: '',
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
  authors: [], narrators: [], tags: [],

  // Cover path.
  cover_path: null,
});

// Virtual tags computed from book fields (never stored). The frontend uses
// this list to filter out virtual names from past-tag suggestions.
// Keep in sync with VIRTUAL_TAG_RULES in lib/books/filters.js.
export const VIRTUAL_TAG_NAMES = ['Antique', 'Vintage', 'Translated', 'Re-read', 'Long', 'Short'];
