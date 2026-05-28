import { api } from '../../api.js';

// Each wizard declares:
//   title       — page heading
//   audit       — audit row label (shown in the caption so users see which
//                 audit they're clearing)
//   field       — target field name (used in aria-labels)
//   fetch       — () => Promise<Array<record>>, the pool of candidate
//                 records. Each wizard owns the response shape: book-
//                 backed wizards unwrap { books: [...] }, author-backed
//                 wizards go through /api/authors?missing=<key>.
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
export const WIZARDS = {
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
    // Server-side combined: fetches the URL, saves under /uploads/, and
    // updates cover_path in one call. The two-step client flow used to
    // leave orphan files on disk when the PATCH failed after the fetch
    // succeeded (transient network blip, browser nav); the new endpoint
    // closes that gap and cleans up the file if the DB update fails.
    commitCandidate: (book, candidate) => api.setBookCoverFromUrl(book.id, candidate.source_url),
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
    fetch: () => api.getAuthors({ missing: 'portrait', limit: 200, sort: 'random' }),
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
    // still rejects non-numeric and non-half-step values.
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
    // Pool delegated to /api/authors?missing=death_date — same gate as
    // the audit row (birth set, death null, birth-year > 110 ago, at
    // least one book), evaluated in SQL instead of round-tripping the
    // full /authors table.
    fetch: () => api.getAuthors({ missing: 'death_date', limit: 200, sort: 'random' }),
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
    fetch: () => api.getAuthors({ missing: 'bio', limit: 200, sort: 'random' }),
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
    // Matches the audit's gate; filtered server-side via ?missing=dates.
    fetch: () => api.getAuthors({ missing: 'dates', limit: 200, sort: 'random' }),
    patch: (id, values) => api.updateAuthor(id, values),
    getName: r => r.name,
    getLink: r => `/authors/${r.id}`,
  },
  author_gender: {
    title: 'Set author gender',
    audit: 'Authors have gender',
    field: 'gender',
    kind:  'author',
    // Pool: authors with no gender set AND at least one book. Matches
    // the audit row; filtered server-side via ?missing=gender so we
    // don't round-trip the full /authors table just to filter it.
    fetch: () => api.getAuthors({ missing: 'gender', limit: 200, sort: 'random' }),
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

export function shuffle(arr) {
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

// Per-card draft persistence for text-mode wizards. Closing the tab
// mid-card (especially mid-bio) used to silently throw away the in-
// progress text. Now TextModeForm writes a debounced snapshot of
// { values, chipInputs } on every keystroke, and hydrates from it on
// card mount instead of resetting to empty.
//
// Key layout: spine.wizard.<wizardKey>.<recordId>. The wizardKey scope
// matters — a half-written bio for author 42 shouldn't surface in the
// publisher wizard for book 42. clearAllDrafts() sweeps the whole
// wizardKey on Refresh pool, since refresh draws a brand-new batch
// and any old drafts become contextually orphaned.
//
// localStorage isn't always available (private-mode quirks, quota
// exceeded, storage disabled). All helpers swallow errors — a draft
// that doesn't persist is a small loss; a wizard that throws on
// keystroke is a big one.
const DRAFT_PREFIX = 'spine.wizard.';

function draftKey(wizardKey, recordId) {
  return `${DRAFT_PREFIX}${wizardKey}.${recordId}`;
}

export function loadDraft(wizardKey, recordId) {
  try {
    const raw = localStorage.getItem(draftKey(wizardKey, recordId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function saveDraft(wizardKey, recordId, data) {
  try {
    localStorage.setItem(draftKey(wizardKey, recordId), JSON.stringify(data));
  } catch { /* quota or disabled — drop silently */ }
}

export function clearDraft(wizardKey, recordId) {
  try { localStorage.removeItem(draftKey(wizardKey, recordId)); }
  catch { /* drop silently */ }
}

export function clearAllDrafts(wizardKey) {
  // localStorage.length + key(i) walk is the only standards-compliant
  // way to enumerate keys. Collect first, delete after — splicing
  // while iterating shifts indices.
  try {
    const prefix = `${DRAFT_PREFIX}${wizardKey}.`;
    const victims = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) victims.push(k);
    }
    for (const k of victims) localStorage.removeItem(k);
  } catch { /* drop silently */ }
}
