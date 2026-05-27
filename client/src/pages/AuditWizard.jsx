import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatAuthors, initialsFor, MOD_KEY } from '../utils.js';
import { submitOnModEnter } from '../components/bookForm/styles.js';
import ChipInput from '../components/bookForm/ChipInput.jsx';
import { useActionGuard } from '../hooks/useActionGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

// Deck-of-cards data-entry wizard. Drives bulk-clearing of a single
// audit row by presenting one missing-data book at a time with a small
// fixed set of option buttons + Skip. The first wizard (and proof of
// concept) is `binding` — fed by Audit's "Physical books have binding"
// row. Other wizards can register here as additional WIZARDS entries.
//
// Design choices the wizard frame commits to:
//   - Skip is first-class — same size + adjacency as the choice
//     buttons. The path of least resistance must not be a guess.
//   - Session-only skip memory. A book skipped this session stays out
//     of rotation until the wizard is reopened, so the user doesn't
//     bounce off the same "I can't tell" card. The audit count still
//     includes them; next visit they come back fresh.
//   - Keyboard shortcuts (1..N for options, S or N for skip) because
//     the whole point is throughput. Click-only support would defeat
//     the bulk-entry framing.

// Each wizard declares:
//   title       — page heading
//   audit       — audit row label (shown in the caption so users see which
//                 audit they're clearing)
//   field       — target field name (used in aria-labels)
//   fetch       — () => Promise<Array<record>>, the pool of candidate
//                 records. Each wizard owns the response shape: book-
//                 backed wizards unwrap { books: [...] }, author-backed
//                 wizards filter the flat /authors array client-side.
//   patch       — (id, value) => Promise<record>, encapsulates the
//                 right endpoint + payload key. Lets the wizard work
//                 against any table without branching internally.
//   getName     — (record) => string, used in aria-labels and the title
//                 link's text content. Books use .title; authors .name.
//   getLink     — (record) => string, detail-page URL for the record.
//   kind        — 'book' | 'author' — drives card layout (cover vs
//                 portrait, dates vs publisher line, etc.).
//   mode        — 'enum' (default) | 'text' | 'cover'. Enum renders a
//                 row of option buttons; text renders focused
//                 input(s) and a Save button; cover renders a grid of
//                 candidate cover thumbnails fetched per-card from
//                 /api/search. Keyboard binds adapt per mode.
//   options     — enum-mode only. Left-to-right buttons. The first
//                 option's count historically dominates, so order matters.
//   fields      — text-mode only. Array of input descriptors, each:
//                 { name, label?, placeholder?, multiline?, type?,
//                   min?, max?, step? }. The name is the API payload
//                 key; the patch function decides what to do with the
//                 assembled { name: value, ... } object. Multi-field
//                 wizards (e.g. author_dates) get one input per entry.
//                 Multiline saves on Cmd/Ctrl+Enter so plain Enter
//                 still inserts newlines. type='number' renders an
//                 HTML5 number input with the given min/max/step;
//                 step='0.5' supports series_number's half-steps.
//                 type='people' renders a ChipInput with autocomplete
//                 sourced from /api/books/facets[name]; the field's
//                 payload becomes [{name}, {name}, ...] on save.
//   clearValue  — enum-mode only. Value sent back via PATCH to undo a
//                 fill. For nullable booleans this must be `null`; for
//                 text enums like binding it can be `''`. Text-mode
//                 wizards auto-derive an all-empty values object for
//                 undo from their fields list, so no clearValue here.
const WIZARDS = {
  binding: {
    title: 'Set binding',
    audit: 'Physical books have binding',
    field: 'binding',
    kind:  'book',
    fetch: () => api.getBooks({ formats: 'physical', missing: 'binding', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, value) => api.patchBook(id, { binding: value }),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
    options: [
      { value: 'paperback', label: 'Paperback' },
      { value: 'hardcover', label: 'Hardcover' },
      { value: 'other',     label: 'Other' },
    ],
    clearValue: '',
  },
  fiction: {
    title: 'Set fiction flag',
    audit: 'Owned books have fiction flag',
    field: 'fiction',
    kind:  'book',
    fetch: () => api.getBooks({ tab: 'owned', missing: 'fiction', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, value) => api.patchBook(id, { fiction: value }),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
    // Two-button decision. The PATCH layer accepts native booleans:
    // true → fiction = 1, false → 0, null → clears.
    options: [
      { value: true,  label: 'Fiction' },
      { value: false, label: 'Non-fiction' },
    ],
    clearValue: null,
  },
  format: {
    title: 'Set format',
    audit: 'Owned books have format',
    field: 'format',
    kind:  'book',
    fetch: () => api.getBooks({ tab: 'owned', missing: 'format', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, value) => api.patchBook(id, { format: value }),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
    options: [
      { value: 'physical',  label: 'Physical'  },
      { value: 'ebook',     label: 'Digital'   },
      { value: 'audiobook', label: 'Audiobook' },
    ],
    clearValue: null,
  },
  condition: {
    title: 'Set condition',
    audit: 'Owned physical books have condition',
    field: 'condition',
    kind:  'book',
    fetch: () => api.getBooks({ tab: 'owned', formats: 'physical', missing: 'condition', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, value) => api.patchBook(id, { condition: value }),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
    options: [
      { value: 'new',       label: 'New'       },
      { value: 'fine',      label: 'Fine'      },
      { value: 'very good', label: 'Very good' },
      { value: 'good',      label: 'Good'      },
      { value: 'fair',      label: 'Fair'      },
      { value: 'poor',      label: 'Poor'      },
    ],
    clearValue: '',
  },
  rating: {
    title: 'Set rating',
    audit: 'Finished books have rating',
    field: 'rating',
    kind:  'book',
    fetch: () => api.getBooks({ tab: 'finished', missing: 'rating', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, value) => api.patchBook(id, { rating: value }),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
    // 10-step scale (0.5 → 5 in 0.5 increments). Labels mirror the
    // existing rating-pill rendering in FilterPanel (floor stars +
    // optional half), so a 4½★ here matches the chip elsewhere.
    options: [
      { value: 0.5, label: '½'      },
      { value: 1,   label: '★'      },
      { value: 1.5, label: '★½'     },
      { value: 2,   label: '★★'     },
      { value: 2.5, label: '★★½'    },
      { value: 3,   label: '★★★'    },
      { value: 3.5, label: '★★★½'   },
      { value: 4,   label: '★★★★'   },
      { value: 4.5, label: '★★★★½'  },
      { value: 5,   label: '★★★★★'  },
    ],
    clearValue: null,
  },
  acquisition_source: {
    title: 'Set acquisition source',
    audit: 'Owned books have acquisition source',
    field: 'acquisition_source',
    kind:  'book',
    fetch: () => api.getBooks({ tab: 'owned', missing: 'source', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, value) => api.patchBook(id, { acquisition_source: value }),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
    // Top values from the user's library. The full distribution has a
    // long tail of small physical bookstores; those stay with Skip and
    // can be filled later via BookForm — the wizard only tries to
    // bulk-clear the dominant cases.
    options: [
      { value: 'Audible',     label: 'Audible' },
      { value: 'Kindle',      label: 'Kindle' },
      { value: 'Amazon',      label: 'Amazon' },
      { value: 'Internet',    label: 'Internet' },
      { value: 'Book Outlet', label: 'Book Outlet' },
    ],
    clearValue: '',
  },
  publisher: {
    title: 'Set publisher',
    audit: 'Books have publisher',
    field: 'publisher',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'publisher', placeholder: 'Publisher name' }],
    fetch: () => api.getBooks({ missing: 'publisher', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  description: {
    title: 'Set description',
    audit: 'Books have description',
    field: 'description',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'description', placeholder: 'Book description — paste from a listing or write a short blurb', multiline: true }],
    fetch: () => api.getBooks({ missing: 'description', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  isbn: {
    title: 'Set ISBN',
    audit: 'Printed books have ISBN',
    field: 'isbn',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'isbn', placeholder: 'ISBN-10 or ISBN-13 (hyphens/spaces OK)' }],
    fetch: () => api.getBooks({ missing: 'isbn', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    // Single-string input routes to isbn_10 or isbn_13 by length. The
    // server's PATCH route validates the format and writes only the
    // matching column, but we still null the other so a previously-
    // wrong-format entry gets cleared on save. Empty value clears
    // both columns (undo path).
    patch: (id, values) => {
      const value = values.isbn;
      if (value == null || value === '') {
        return api.patchBook(id, { isbn_10: null, isbn_13: null });
      }
      const stripped = String(value).replace(/[-\s]/g, '');
      if (stripped.length === 13) return api.patchBook(id, { isbn_13: stripped, isbn_10: null });
      if (stripped.length === 10) return api.patchBook(id, { isbn_10: stripped, isbn_13: null });
      return Promise.reject(new Error('ISBN must be 10 or 13 digits'));
    },
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  acquisition_date: {
    title: 'Set acquisition date',
    audit: 'Owned books have acquisition date',
    field: 'acquisition_date',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'acquisition_date', placeholder: 'YYYY or YYYY-MM-DD' }],
    fetch: () => api.getBooks({ tab: 'owned', missing: 'acquired', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  date_finished: {
    title: 'Set date finished',
    audit: 'Finished books have date finished',
    field: 'date_finished',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'date_finished', placeholder: 'YYYY or YYYY-MM-DD' }],
    fetch: () => api.getBooks({ tab: 'finished', missing: 'date_finished', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  date_started: {
    title: 'Set start date',
    audit: 'Reading books have start date',
    field: 'date_started',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'date_started', placeholder: 'YYYY or YYYY-MM-DD' }],
    fetch: () => api.getBooks({ tab: 'reading', missing: 'date_started', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  year_published: {
    title: 'Set year published',
    audit: 'Owned books have year published',
    field: 'year_published',
    kind:  'book',
    mode:  'text',
    // step=1 keeps the up/down spinners honest; min isn't set because
    // pre-modern works carry negative years (BCE) and the server's
    // validation just rejects 0. Same shape applies to year_edition.
    fields: [{ name: 'year_published', type: 'number', step: 1, placeholder: 'YYYY (negative for BCE)' }],
    fetch: () => api.getBooks({ tab: 'owned', missing: 'year', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  year_edition: {
    title: 'Set year edition',
    audit: 'Owned physical books have year_edition',
    field: 'year_edition',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'year_edition', type: 'number', step: 1, placeholder: 'Printing year (not edition number)' }],
    fetch: () => api.getBooks({ tab: 'owned', formats: 'physical', missing: 'year_edition', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  page_count: {
    title: 'Set page count',
    audit: 'Audiobooks have page count (cross-format)',
    field: 'page_count',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'page_count', type: 'number', min: 1, step: 1, placeholder: 'Print-equivalent page count' }],
    fetch: () => api.getBooks({ formats: 'audiobook', missing: 'page_count', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  duration: {
    title: 'Set duration',
    audit: 'Audiobooks have duration',
    field: 'duration_minutes',
    kind:  'book',
    mode:  'text',
    fields: [{ name: 'duration_minutes', type: 'number', min: 1, step: 1, placeholder: 'Minutes (e.g. 480 for 8h)' }],
    fetch: () => api.getBooks({ formats: 'audiobook', missing: 'duration', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  cover: {
    title: 'Set cover',
    audit: 'Owned books have a cover',
    field: 'cover_path',
    kind:  'book',
    mode:  'cover',
    fetch: () => api.getBooks({ tab: 'owned', missing: 'cover', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    // initialQuery builds the per-card OL search string. surname keeps
    // results disambiguated without over-restricting on long names.
    initialQuery: r => {
      const author = r.authors?.[0]?.name ?? '';
      const surname = author.split(/\s+/).filter(Boolean).pop() ?? '';
      return [r.title, surname].filter(Boolean).join(' ');
    },
    searchCandidates: async (query) => {
      const results = await api.searchBooks(query);
      return (results || [])
        .filter(r => r.cover_url)
        .map(r => ({
          thumbnail_url: r.cover_url,
          label:         [r.title, r.authors?.[0], r.publisher].filter(Boolean).join(' · '),
          source_url:    r.cover_url,
        }));
    },
    // Two-step: fetch the candidate URL into /uploads/ via /upload/fetch,
    // then PATCH cover_path to the resulting local path.
    commitCandidate: async (book, candidate) => {
      const { path } = await api.fetchCover(candidate.source_url);
      return api.patchBook(book.id, { cover_path: path });
    },
    // Undo: clear cover_path; server deletes the just-uploaded file.
    clearCandidate: (book) => api.patchBook(book.id, { cover_path: null }),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  portrait: {
    title: 'Set portrait',
    audit: 'Authors have portrait',
    field: 'photo_path',
    kind:  'author',
    mode:  'cover',
    fetch: async () => {
      const arr = await api.getAuthors();
      return arr.filter(a => !a.has_photo && (a.book_count || 0) > 0).slice(0, 200);
    },
    initialQuery: r => r.name,
    searchCandidates: async (query) => {
      const results = await api.searchAuthorsOL(query);
      return (results || [])
        .filter(r => r.photo_url)
        .map(r => ({
          thumbnail_url: r.photo_url,
          label:         [r.name, r.birth_date && `b. ${r.birth_date}`, r.top_work].filter(Boolean).join(' · '),
          source_url:    r.photo_url,
        }));
    },
    // Server-side combined: fetches the URL, validates size, saves
    // under uploads/authors/, updates photo_path in one call.
    commitCandidate: (author, candidate) => api.setAuthorPhotoFromUrl(author.id, candidate.source_url),
    clearCandidate: (author) => api.deleteAuthorPhoto(author.id),
    getName: r => r.name,
    getLink: r => `/authors/${r.id}`,
  },
  authors: {
    title: 'Set authors',
    audit: 'Books have authors',
    field: 'authors',
    kind:  'book',
    mode:  'text',
    fields: [{
      name: 'authors',
      type: 'people',
      label: 'Authors',
      placeholder: 'Type a name, Enter or comma to add',
    }],
    fetch: () => api.getBooks({ missing: 'author', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  narrators: {
    title: 'Set narrators',
    audit: 'Audiobooks have narrator',
    field: 'narrators',
    kind:  'book',
    mode:  'text',
    fields: [{
      name: 'narrators',
      type: 'people',
      label: 'Narrators',
      placeholder: 'Type a name, Enter or comma to add',
    }],
    fetch: () => api.getBooks({ formats: 'audiobook', missing: 'narrator', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  translators: {
    title: 'Set translators',
    audit: 'Translated works have translator',
    field: 'translators',
    kind:  'book',
    mode:  'text',
    fields: [{
      name: 'translators',
      type: 'people',
      label: 'Translators',
      placeholder: 'Type a name, Enter or comma to add',
    }],
    fetch: () => api.getBooks({ missing: 'translator', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  series_number: {
    title: 'Set series number',
    audit: 'Series-tagged books have series number',
    field: 'series_number',
    kind:  'book',
    mode:  'text',
    // step=0.5 enforces the half-volume convention from memory
    // (feedback_series_number_step): 1, 1.5, 2 are accepted; 1.1 / 1.7
    // are not. Browser blocks invalid steps in the spinner UI; pasted
    // values get past it, but the server validation in routes/books.js
    // still rejects non-numeric.
    fields: [{ name: 'series_number', type: 'number', min: 0.5, step: 0.5, placeholder: 'e.g. 1, 1.5, 2' }],
    fetch: () => api.getBooks({ missing: 'series_number', limit: 200, sort: 'random' }).then(r => r.books ?? []),
    patch: (id, values) => api.patchBook(id, values),
    getName: r => r.title,
    getLink: r => `/books/${r.id}`,
  },
  old_birth_death: {
    title: 'Set death date',
    audit: 'Old-birth authors have death date',
    field: 'death_date',
    kind:  'author',
    mode:  'text',
    fields: [{ name: 'death_date', placeholder: 'YYYY, YYYY-MM, or YYYY-MM-DD' }],
    // Audit's gate: birth_date set, death_date null, leading year of
    // birth more than 110 years ago, with at least one book. We mirror
    // it client-side from the flat /authors response. The regex pulls
    // the leading optional-negative year out of "1850" / "1850-06-27"
    // / "-300" forms, matching the server's SUBSTR-based extraction.
    fetch: async () => {
      const arr = await api.getAuthors();
      const now = new Date().getFullYear();
      return arr.filter(a => {
        if (a.death_date) return false;
        if (!a.birth_date) return false;
        if ((a.book_count || 0) === 0) return false;
        const m = String(a.birth_date).match(/^(-?\d+)/);
        if (!m) return false;
        return parseInt(m[1], 10) < now - 110;
      }).slice(0, 200);
    },
    patch: (id, values) => api.updateAuthor(id, values),
    getName: r => r.name,
    getLink: r => `/authors/${r.id}`,
  },
  author_bio: {
    title: 'Set author bio',
    audit: 'Authors have bio',
    field: 'bio',
    kind:  'author',
    mode:  'text',
    fields: [{ name: 'bio', placeholder: 'Library-catalog bio — 60-150 words, structured 4-part shape per the bio convention (see memory feedback_author_bio_standard).', multiline: true }],
    fetch: async () => {
      const arr = await api.getAuthors();
      return arr.filter(a => !a.has_bio && (a.book_count || 0) > 0).slice(0, 200);
    },
    patch: (id, values) => api.updateAuthor(id, values),
    getName: r => r.name,
    getLink: r => `/authors/${r.id}`,
  },
  author_dates: {
    title: 'Set author dates',
    audit: 'Authors have birth/death dates',
    field: 'birth_date',
    kind:  'author',
    mode:  'text',
    // Two date inputs on one card. Save commits whatever the user has
    // filled — partial fills (just birth, just death) are common since
    // older authors often have one knowable date but not the other.
    fields: [
      { name: 'birth_date', label: 'Born', placeholder: 'YYYY or YYYY-MM-DD' },
      { name: 'death_date', label: 'Died', placeholder: 'YYYY or YYYY-MM-DD' },
    ],
    // Pool: authors with NEITHER date set AND at least one book.
    // Matches the audit's gate.
    fetch: async () => {
      const arr = await api.getAuthors();
      return arr.filter(a => !a.birth_date && !a.death_date && (a.book_count || 0) > 0).slice(0, 200);
    },
    patch: (id, values) => api.updateAuthor(id, values),
    getName: r => r.name,
    getLink: r => `/authors/${r.id}`,
  },
  author_gender: {
    title: 'Set author gender',
    audit: 'Authors have gender',
    field: 'gender',
    kind:  'author',
    // /api/authors returns a flat array with book_count/story_count;
    // the audit gates the gap on "has at least one book", so we
    // filter client-side to match. Then slice to keep the pool size
    // consistent with the book wizards' limit-200 pattern.
    fetch: async () => {
      const arr = await api.getAuthors();
      return arr.filter(a => !a.gender && (a.book_count || 0) > 0).slice(0, 200);
    },
    patch: (id, value) => api.updateAuthor(id, { gender: value }),
    getName: r => r.name,
    getLink: r => `/authors/${r.id}`,
    options: [
      { value: 'male',   label: 'Male' },
      { value: 'female', label: 'Female' },
      { value: 'other',  label: 'Other' },
    ],
    clearValue: null,
  },
};

function shuffle(arr) {
  // Fisher-Yates in-place. The fetch may not return books in a
  // randomised order, and a stable order would make the bulk-entry
  // pass feel like a march through alphabetical pages.
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function AuditWizard() {
  const { wizardKey } = useParams();
  const cfg = WIZARDS[wizardKey];

  const [pool, setPool] = useState(null);     // null = loading
  const [idx, setIdx]   = useState(0);
  const [filled, setFilled]   = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError]     = useState(null);
  // Bumped by Refresh pool to re-run the fetch effect without a full
  // route reload (navigate(0) would re-mount everything and re-fetch
  // any other route data). Toggling this is enough to draw a new batch.
  const [refreshTick, setRefreshTick] = useState(0);
  // Single-step undo: the position + action of the most recent
  // fill/skip. Cleared after use; we don't keep a stack because the
  // card-deck flow is forward-driven and a multi-step undo would
  // mostly invite cascading regret-clicks.
  const [lastAction, setLastAction] = useState(null);
  // Text-mode wizards keep an in-flight values object here (keyed by
  // each field's `name`). For people-type fields, values[name] is an
  // Array<string> of committed chips; chipInputs[name] holds the
  // in-progress text for THAT field's ChipInput. Reset on every card
  // change so leftover input from the previous card doesn't bleed in.
  // Enum-mode wizards ignore this state.
  const [values, setValues] = useState({});
  const [chipInputs, setChipInputs] = useState({});
  // Autocomplete suggestions for people fields. Fetched once when the
  // wizard mounts (a wizard's people fields don't change mid-session).
  // Shape matches /api/books/facets: { authors, narrators, translators }.
  const [suggestions, setSuggestions] = useState(null);
  // Cover-mode state. Candidates are refetched per card via OL search;
  // loading/error track the current fetch. Held outside `values` since
  // they're per-card derived data, not user input.
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState(null);
  // Refine query — the search string used to fetch candidates. Reset
  // to "{title} {first-author surname}" on every card; user can edit
  // and re-search if the auto-query missed.
  const [coverQuery, setCoverQuery] = useState('');
  // Candidate indices whose <img> 404'd or failed to decode. Tiles for
  // those indices are dropped from the rendered grid so OL placeholder
  // results (we pass `?default=false` so missing photos 404 cleanly)
  // and broken thumbnails don't take up space.
  const [failedThumbs, setFailedThumbs] = useState(() => new Set());
  const inputRef = useRef(null);
  const saveGuard = useActionGuard();

  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    const needsSuggestions = cfg.fields?.some(f => f.type === 'people');
    Promise.all([
      cfg.fetch(),
      needsSuggestions ? api.getBookFacets() : Promise.resolve(null),
    ]).then(([arr, facets]) => {
      if (cancelled) return;
      setPool(shuffle(arr));
      setSuggestions(facets);
      setIdx(0);
      setFilled(0);
      setSkipped(0);
      setLastAction(null);
    }).catch(() => {
      if (cancelled) return;
      // Land in the Done view instead of leaving pool=null (which
      // keeps the "Loading wizard…" message visible forever). The
      // error banner tells the user what happened; Refresh pool
      // gives them a retry path.
      setPool([]);
      setError('Failed to load records for the wizard.');
    });
    return () => { cancelled = true; };
  }, [cfg, wizardKey, refreshTick]);

  const current = pool && idx < pool.length ? pool[idx] : null;

  // Text-mode: reset all field values and re-focus the first input on
  // every card change so typing never lands in a stale value, and the
  // cursor is always where the user expects. People fields default to
  // an empty array (committed chips) plus an empty chipInputs buffer
  // (in-progress text). cfg can be undefined on the "Unknown wizard"
  // branch — guard for that.
  useEffect(() => {
    if (cfg?.mode !== 'text') return;
    setValues(Object.fromEntries(cfg.fields.map(f => [f.name, f.type === 'people' ? [] : ''])));
    setChipInputs(Object.fromEntries(cfg.fields.filter(f => f.type === 'people').map(f => [f.name, ''])));
    inputRef.current?.focus();
  }, [cfg, current?.id]);

  // Cover-mode: auto-search per card using the wizard's source-
  // specific search function (api.searchBooks for book covers,
  // api.searchAuthorsOL for author portraits). Initial query comes
  // from cfg.initialQuery(record). Each candidate is normalised to
  // { thumbnail_url, label, source_url } so the render block is
  // source-agnostic.
  useEffect(() => {
    if (cfg?.mode !== 'cover' || !current) return;
    const initial = cfg.initialQuery(current);
    setCoverQuery(initial);
    setCandidates([]);
    setCandidatesError(null);
    setFailedThumbs(new Set());
    inputRef.current?.focus();
    if (!initial.trim()) return;
    setCandidatesLoading(true);
    let cancelled = false;
    cfg.searchCandidates(initial)
      .then(results => {
        if (cancelled) return;
        setCandidates(results || []);
      })
      .catch(() => {
        if (cancelled) return;
        setCandidatesError('Search failed. Try refining the query.');
      })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [cfg, current?.id]);

  async function rerunCoverSearch() {
    if (!coverQuery.trim()) return;
    setCandidatesLoading(true);
    setCandidatesError(null);
    setCandidates([]);
    setFailedThumbs(new Set());
    try {
      const results = await cfg.searchCandidates(coverQuery);
      setCandidates(results || []);
    } catch {
      setCandidatesError('Search failed. Try refining the query.');
    } finally {
      setCandidatesLoading(false);
    }
  }

  async function pickCover(candidate) {
    if (!current) return;
    if (!saveGuard.begin()) return;
    setError(null);
    const actionIdx = idx;
    try {
      await cfg.commitCandidate(current, candidate);
      setFilled(n => n + 1);
      setLastAction({ index: actionIdx, type: 'fill' });
      advance();
    } catch {
      setError('Failed to set image. Try another candidate or skip.');
    } finally {
      saveGuard.end();
    }
  }

  function advance() {
    setIdx(i => i + 1);
    setError(null);
  }

  async function pick(value) {
    if (!current) return;
    if (!saveGuard.begin()) return;
    setError(null);
    const actionIdx = idx;
    try {
      await cfg.patch(current.id, value);
      setFilled(n => n + 1);
      setLastAction({ index: actionIdx, type: 'fill' });
      advance();
    } catch {
      setError('Failed to save — try again or skip.');
    } finally {
      saveGuard.end();
    }
  }

  function skip() {
    if (saveGuard.busy) return;
    setSkipped(n => n + 1);
    setLastAction({ index: idx, type: 'skip' });
    advance();
  }

  // Single-step undo. Fills revert via a PATCH that clears the field
  // (empty string → server's existing patchBook treats as null); skips
  // are local-only so we just decrement the counter. Either way, idx
  // rewinds to the previous card so the user can re-decide.
  async function undo() {
    if (!lastAction || saveGuard.busy) return;
    const { index, type } = lastAction;
    if (type === 'fill') {
      if (!saveGuard.begin()) return;
      setError(null);
      try {
        const target = pool[index];
        if (cfg.mode === 'cover') {
          // Cover-mode owns its own clear path (server endpoint, file
          // deletion). It doesn't go through cfg.patch.
          await cfg.clearCandidate(target);
        } else {
          // Text-mode auto-derives a clear payload from the fields list:
          // people fields get an empty array (clears the join table);
          // text/number fields get an empty string (server coerces to
          // null). Enum-mode uses the explicit clearValue.
          const clearPayload = cfg.mode === 'text'
            ? Object.fromEntries(cfg.fields.map(f => [f.name, f.type === 'people' ? [] : '']))
            : cfg.clearValue;
          await cfg.patch(target.id, clearPayload);
        }
        setFilled(n => n - 1);
      } catch {
        setError('Failed to undo — try again.');
        saveGuard.end();
        return;
      }
      saveGuard.end();
    } else {
      setSkipped(n => n - 1);
    }
    setIdx(index);
    setLastAction(null);
    setError(null);
  }

  // Keyboard shortcuts for throughput: 1..N pick the matching option,
  // S to skip, U to undo. Number range capped to the actual options
  // length so a stray key press doesn't fire something undefined.
  // When a wizard has 10 options (rating), `0` maps to the 10th —
  // 1..9 then 0 is the natural number-row layout.
  useEffect(() => {
    if (!cfg) return undefined;
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Number-row shortcuts only apply to enum-mode wizards. Text-mode
      // wizards have no options array; the Save / Skip flow uses Enter
      // (form submit, handled natively) and Esc (input onKeyDown).
      if (cfg.mode === 'enum' || cfg.mode === undefined) {
        const raw = parseInt(e.key, 10);
        const n = (raw === 0 && cfg.options.length === 10) ? 10 : raw;
        if (!Number.isNaN(n) && n >= 1 && n <= cfg.options.length && current) {
          e.preventDefault();
          pick(cfg.options[n - 1].value);
          return;
        }
      }
      // Skip via S works in any non-text mode (text uses Esc on the
      // focused input). Cover mode wants S too; enum mode wants S too.
      if (cfg.mode !== 'text' && e.key.toLowerCase() === 's' && current) {
        e.preventDefault(); skip(); return;
      }
      if (e.key.toLowerCase() === 'u' && lastAction) { e.preventDefault(); undo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!cfg) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <p role="alert" className="text-sm text-warn">Unknown wizard: <code>{wizardKey}</code></p>
        <Link to="/audit" className="text-xs text-neutral-500 hover:text-neutral-200">← Back to Audit</Link>
      </div>
    );
  }

  if (pool === null) {
    return <div role="status" className="text-neutral-700 text-sm">Loading wizard…</div>;
  }

  const done = idx >= pool.length;
  const total = pool.length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">{cfg.title}</h1>
        <Link to="/audit" className="text-xs text-neutral-500 hover:text-neutral-200 transition-colors">
          ← Back to Audit
        </Link>
      </div>

      <p className="text-xs text-neutral-500">
        Bulk-clear the <span className="text-neutral-300">{cfg.audit}</span> audit one card at a time.
        {total > 0 && ` Pool of ${total} loaded this session.`}
      </p>

      {/* Progress strip — always visible so the user can pace themselves
          and notice their own skip ratio. Undo lives here, anchored to
          the counters that change. Hidden until there's an action to
          undo so it doesn't look like a stray control. */}
      <div className="flex items-center gap-6 text-xs text-neutral-500 tabular-nums border-y border-neutral-800 py-2">
        <span><span className="text-parchment">{filled}</span> filled</span>
        <span><span className="text-neutral-400">{skipped}</span> skipped</span>
        {lastAction && (
          <button
            type="button"
            onClick={undo}
            disabled={saveGuard.busy}
            className="text-neutral-500 hover:text-parchment disabled:opacity-40 transition-colors"
            aria-label={`Undo last ${lastAction.type}`}
          >
            ← Undo
          </button>
        )}
        <span className="ml-auto"><span className="text-neutral-400">{Math.max(0, total - idx)}</span> remaining</span>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {done ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-2xl font-slab text-parchment">Done for this session.</p>
          <p className="text-sm text-neutral-500">
            Filled {filled}, skipped {skipped}.
            {total >= 200 && ' (200-card pool. Refresh to draw another batch.)'}
          </p>
          <div className="flex items-center justify-center gap-4 mt-6">
            <button
              type="button"
              onClick={() => { setPool(null); setError(null); setRefreshTick(t => t + 1); }}
              className="text-sm text-neutral-400 hover:text-parchment transition-colors"
            >
              Refresh pool
            </button>
            <Link to="/audit" className="text-sm text-neutral-400 hover:text-parchment transition-colors">
              Back to Audit
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Card — cover/portrait + identifying metadata. Layout
              branches on cfg.kind: books get a 2:3 cover and a
              publisher/year/pages line; authors get a square portrait,
              dates, and a book-count + bio snippet. Both link through
              to the record's detail page in case the wizard's snapshot
              isn't enough context. */}
          <div className="flex gap-5 items-start py-2">
            {cfg.kind === 'author' ? (
              <div className="w-24 h-24 flex-shrink-0 rounded-full overflow-hidden bg-neutral-800">
                {current.photo_path
                  ? <img src={current.photo_path} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-xs text-neutral-500 font-medium tracking-wide">{initialsFor(current.name)}</div>}
              </div>
            ) : (
              <div className="w-24 h-36 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
                {current.cover_path
                  ? <img src={current.cover_path} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-xs text-neutral-500 font-medium tracking-wide">{initialsFor(current.title)}</div>}
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-1">
              <Link to={cfg.getLink(current)} className="text-base font-medium text-parchment hover:text-oak transition-colors block">
                {cfg.getName(current)}
              </Link>
              {cfg.kind === 'author' ? (
                <>
                  {(current.birth_date || current.death_date) && (
                    <p className="text-sm text-neutral-400">
                      {current.birth_date || '?'} – {current.death_date || ''}
                    </p>
                  )}
                  <p className="text-xs text-neutral-600">
                    {[
                      current.book_count ? `${current.book_count} book${current.book_count === 1 ? '' : 's'}` : null,
                      current.story_count ? `${current.story_count} stor${current.story_count === 1 ? 'y' : 'ies'}` : null,
                    ].filter(Boolean).join(' · ') || '—'}
                  </p>
                </>
              ) : (
                <>
                  {current.authors?.length > 0 && (
                    <p className="text-sm text-neutral-400">{formatAuthors(current.authors.map(a => a.name))}</p>
                  )}
                  <p className="text-xs text-neutral-600">
                    {[
                      current.publisher,
                      current.year_edition,
                      current.page_count ? `${current.page_count} pp` : null,
                    ].filter(Boolean).join(' · ') || '—'}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Choice row. Skip carries the same visual weight as the
              option buttons / Save — the data-quality cost of a
              guessing bias outweighs the dopamine of clearing the
              count. Mode branches: enum mode is a button grid; text
              mode is a focused input + Save / Skip / Undo. */}
          {cfg.mode === 'text' ? (() => {
            const anyMultiline = cfg.fields.some(f => f.multiline);
            // Save is enabled when any field has content. For people
            // fields, both committed chips and uncommitted input text
            // count — submit auto-commits the latter before sending.
            const anyFilled = cfg.fields.some(f => {
              if (f.type === 'people') {
                return (values[f.name]?.length > 0) || (chipInputs[f.name]?.trim());
              }
              return (values[f.name] ?? '').trim();
            });
            return (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  // Build the payload from only the filled fields so a
                  // user who fills birth but leaves death blank doesn't
                  // wipe death (or in single-field wizards, sends
                  // exactly the field they edited).
                  const payload = {};
                  for (const f of cfg.fields) {
                    if (f.type === 'people') {
                      // Merge any uncommitted input text (split on
                      // commas, deduped) into the committed chip list
                      // before sending — users frequently type a name
                      // and click Save without hitting Enter.
                      const existing = values[f.name] ?? [];
                      const pending = (chipInputs[f.name] ?? '')
                        .split(',').map(s => s.trim()).filter(Boolean);
                      const merged = [...existing];
                      for (const p of pending) {
                        if (!merged.includes(p)) merged.push(p);
                      }
                      if (merged.length > 0) {
                        payload[f.name] = merged.map(name => ({ name }));
                      }
                    } else {
                      const v = (values[f.name] ?? '').trim();
                      if (v) payload[f.name] = v;
                    }
                  }
                  if (Object.keys(payload).length === 0) return;
                  pick(payload);
                }}
                className="space-y-2"
              >
                {cfg.fields.map((f, i) => {
                  if (f.type === 'people') {
                    return (
                      <ChipInput
                        key={f.name}
                        label={f.label ?? f.name}
                        items={values[f.name] ?? []}
                        onItemsChange={items => setValues(v => ({ ...v, [f.name]: items }))}
                        inputValue={chipInputs[f.name] ?? ''}
                        onInputChange={s => setChipInputs(c => ({ ...c, [f.name]: s }))}
                        datalistId={`wizard-${f.name}-list`}
                        datalistOptions={suggestions?.[f.name] ?? []}
                        placeholder={f.placeholder ?? 'Type a name, Enter or comma to add'}
                        inputClassName="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 disabled:opacity-40"
                      />
                    );
                  }
                  const common = {
                    ref: i === 0 ? inputRef : null,
                    value: values[f.name] ?? '',
                    onChange: e => setValues(v => ({ ...v, [f.name]: e.target.value })),
                    placeholder: f.placeholder ?? '',
                    'aria-label': `Set ${f.label || f.name} for ${cfg.getName(current)}`,
                    disabled: saveGuard.busy,
                  };
                  return (
                    <div key={f.name}>
                      {f.label && <label className="block text-xs text-neutral-500 mb-1">{f.label}</label>}
                      {f.multiline ? (
                        <textarea
                          {...common}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { e.preventDefault(); skip(); return; }
                            submitOnModEnter(e);
                          }}
                          rows={6}
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 disabled:opacity-40 resize-y"
                        />
                      ) : (
                        <input
                          {...common}
                          type={f.type ?? 'text'}
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); skip(); } }}
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50 disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      )}
                    </div>
                  );
                })}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="submit"
                    disabled={saveGuard.busy || !anyFilled}
                    className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
                  >
                    <span>Save</span>
                    <span className="text-[10px] text-neutral-500">{anyMultiline ? `${MOD_KEY}+↵` : '↵'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={skip}
                    disabled={saveGuard.busy}
                    aria-label={`Skip ${cfg.getName(current)}`}
                    className="px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-400 hover:text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
                  >
                    <span>Skip</span>
                    <span className="text-[10px] text-neutral-600">Esc</span>
                  </button>
                </div>
              </form>
            );
          })() : cfg.mode === 'cover' ? (
            <div className="space-y-3">
              {/* Refine query — pre-populated from {title} {surname} but
                  user can rewrite if the auto-search missed (common
                  with subtitled titles or single-name authors). */}
              <form
                onSubmit={e => { e.preventDefault(); rerunCoverSearch(); }}
                className="flex gap-2"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={coverQuery}
                  onChange={e => setCoverQuery(e.target.value)}
                  placeholder="Search query"
                  aria-label="Cover search query"
                  className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-parchment text-sm focus:outline-none focus:border-oak/50"
                />
                <button
                  type="submit"
                  disabled={candidatesLoading || !coverQuery.trim()}
                  className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-parchment text-sm rounded transition-colors"
                >
                  Search
                </button>
              </form>

              {candidatesLoading && <p role="status" className="text-xs text-neutral-500">Searching…</p>}
              {candidatesError && <p role="alert" className="text-xs text-warn">{candidatesError}</p>}
              {!candidatesLoading && !candidatesError && candidates.length === 0 && (
                <p className="text-xs text-neutral-500">No cover candidates. Try refining the query or skip.</p>
              )}

              {candidates.length > 0 && (() => {
                const visible = candidates
                  .map((c, i) => ({ c, i }))
                  .filter(({ i }) => !failedThumbs.has(i));
                if (visible.length === 0) {
                  return <p className="text-xs text-neutral-500">No real images returned. Try refining the query or skip.</p>;
                }
                return (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {visible.map(({ c, i }) => (
                      <button
                        key={`${c.source_url}-${i}`}
                        type="button"
                        onClick={() => pickCover(c)}
                        disabled={saveGuard.busy}
                        aria-label={`Use image: ${c.label || 'unlabeled candidate'}`}
                        title={c.label || ''}
                        className={`bg-neutral-800 rounded overflow-hidden ring-1 ring-transparent hover:ring-oak transition-all disabled:opacity-40 disabled:cursor-wait ${cfg.kind === 'author' ? 'aspect-square' : 'aspect-[2/3]'}`}
                      >
                        <img
                          src={c.thumbnail_url}
                          alt=""
                          onError={() => setFailedThumbs(prev => {
                            const next = new Set(prev);
                            next.add(i);
                            return next;
                          })}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                );
              })()}

              {/* Skip — equal-weight with the candidate clicks, same
                  framing as the enum-mode wizard. */}
              <button
                type="button"
                onClick={skip}
                disabled={saveGuard.busy}
                aria-label={`Skip ${cfg.getName(current)}`}
                className="w-full px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-400 hover:text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
              >
                <span>Skip</span>
                <span className="text-[10px] text-neutral-600">S</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {cfg.options.map((opt, i) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => pick(opt.value)}
                  disabled={saveGuard.busy}
                  aria-label={`Set ${cfg.field} for ${cfg.getName(current)} to ${opt.label}`}
                  className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-wait text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
                >
                  <span>{opt.label}</span>
                  <span className="text-[10px] text-neutral-500">{i === 9 && cfg.options.length === 10 ? '0' : i + 1}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={skip}
                disabled={saveGuard.busy}
                aria-label={`Skip ${cfg.getName(current)}`}
                className="px-4 py-3 bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 text-neutral-400 hover:text-parchment text-sm rounded transition-colors flex flex-col items-center gap-1"
              >
                <span>Skip</span>
                <span className="text-[10px] text-neutral-600">S</span>
              </button>
            </div>
          )}

          <p className="text-[10px] text-neutral-600 text-center">
            Keyboard: {cfg.mode === 'text'
              ? `${cfg.fields.some(f => f.multiline) ? `${MOD_KEY}+Enter` : 'Enter'} to save, Esc to skip, U to undo`
              : cfg.mode === 'cover'
                ? 'Click a thumbnail to set, S to skip, U to undo'
                : `${cfg.options.map((_, i) => i === 9 && cfg.options.length === 10 ? '0' : i + 1).join(' / ')} to choose, S to skip, U to undo`}
          </p>
        </>
      )}
    </div>
  );
}
