// Generic person-list formatter — used for authors, narrators, and
// translators (all share the [{id, name}] | [string] shape). Returns null
// for empty input, the bare name for one, "A & B" for two, "A, B & C" for
// three, and "A et al." for four or more.
export function formatAuthors(authors) {
  if (!authors?.length) return null;
  const names = authors.map(a => (typeof a === 'string' ? a : a.name));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]} et al.`;
}

// Renders a year integer as "1965" or "800 BCE". Returns '' for null/undefined.
// year 0 is invalid (rejected at validation), so we don't handle it specially.
export function formatYear(y) {
  if (y == null) return '';
  return y > 0 ? String(y) : `${-y} BCE`;
}

export function sortTitle(title) {
  return (title || '').replace(/^(the|a|an)\s+/i, '');
}

// "5 books", "1 book". Default pluralForm appends "s"; pass an explicit
// override for irregulars (shelves, matches, etc.).
export function plural(n, singular, pluralForm) {
  return `${n} ${pluralWord(n, singular, pluralForm)}`;
}

// Just the noun, no count — for label slots like <Row label="Narrators">
// where the count lives elsewhere in the row.
export function pluralWord(n, singular, pluralForm) {
  return n === 1 ? singular : (pluralForm ?? singular + 's');
}

export function realTagNames(tags) {
  return (tags ?? []).filter(t => !t.virtual).map(t => t.name);
}

// Formats a YYYY-MM-DD into "Apr 12" (same year) or "Apr 12, 2024" (otherwise).
// Used by Diary tooltip and Stats streak captions; noon offsets the parsed
// Date so DST/TZ rounding doesn't bump the day either way. en-US order is
// canonical across the app — see also formatDate / formatPartialDate.
export function fmtShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// Formats a YYYY-MM into "Apr 2026". Used by Stats monthly-streak ranges.
export function fmtShortMonth(yearMonthStr) {
  if (!yearMonthStr) return '';
  const [y, m] = yearMonthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Converts an ISO-week identifier ("2026-W17") to the Monday-of-that-week
// YYYY-MM-DD string, then formats it via fmtShortDate. ISO 8601 week 1 is
// the week containing the year's first Thursday (equivalently: Jan 4).
export function fmtIsoWeekMonday(isoWeekStr) {
  if (!isoWeekStr) return '';
  const [yStr, wStr] = isoWeekStr.split('-W');
  const year = parseInt(yStr);
  const week = parseInt(wStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);
  return fmtShortDate(monday.toISOString().slice(0, 10));
}

// Modifier-key glyph for the user's platform — '⌘' on macOS/iOS,
// 'Ctrl' everywhere else (Windows/Linux/Android). Used to render
// keyboard-shortcut hints correctly; the underlying handlers all
// accept e.ctrlKey || e.metaKey regardless of platform.
export const MOD_KEY = (() => {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? '⌘' : 'Ctrl';
})();

// Render a full ISO YYYY-MM-DD date as "July 18, 1938". Anchors at noon
// so any UTC-vs-local boundary doesn't drift to the prior day. en-US
// order is canonical across the app.
export function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// Format a partial date — YYYY / YYYY-MM / YYYY-MM-DD — as a human
// label: "1938" / "July 1938" / "July 18, 1938". Returns null for empty.
// Handles BCE years (leading '-' → "65 BCE" / "December 65 BCE" /
// "December 8, 65 BCE"); Date() can't construct negative years natively,
// so we parse and compose manually for all cases — keeps positive and
// BCE branches consistent.
const PARTIAL_DATE_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export function formatPartialDate(val) {
  if (!val) return null;
  const m = String(val).match(/^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return String(val);
  const year  = parseInt(m[1], 10);
  const month = m[2] ? parseInt(m[2], 10) : null;
  const day   = m[3] ? parseInt(m[3], 10) : null;
  const yearLabel = year < 0 ? `${-year} BCE` : String(year);
  if (!month) return yearLabel;
  const monthLabel = PARTIAL_DATE_MONTHS[month - 1] ?? '';
  if (!day) return `${monthLabel} ${yearLabel}`;
  return `${monthLabel} ${day}, ${yearLabel}`;
}

// Render a minute count as hours-and-minutes, smart: skips the hour
// segment when it would be "0h", skips the minute segment when it
// would be "0m". So 90 → "1h 30m", 120 → "2h", 45 → "45m". Used
// everywhere a duration / elapsed-time is displayed (ProgressSection,
// ReadingLog, MetadataList, BookCard, Diary day-headers + tooltips) —
// previously each site reinvented this with slight variations, some
// of which printed awkward "0h 30m" or "2h 0m" outputs.
export function fmtHM(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Human labels for the three format enum values stored on books. Shared
// across BrowsePage, Stats, FilterPanel (and any future surface that
// needs a non-LC display string) so adding a fourth format means
// touching exactly one place.
export const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

// Display labels for Library tabs. Mirrors the TABS table in
// pages/Library.jsx — kept here so libraryLabelForUrl can read it
// without importing a page component (cyclic-import risk).
const LIBRARY_TAB_LABEL = {
  reading: 'Reading',
  finished: 'Finished',
  unread: 'Unread',
  owned: 'Owned',
  prev_owned: 'Prev. owned',
  never_owned: 'Never owned',
  all: 'All',
  archived: 'Archived',
};

// Given a Library URL ("/", "/?tab=reading", "/?tab=finished&tags=...")
// return the most informative back-link label. Only the `tab` param is
// honoured — going deeper (tags, statuses, etc.) is plausible but risks
// getting clever. Anything else degrades to "Library". Used to label
// the back link on cold-tab BookDetail arrivals where document.referrer
// recovers the Library URL but no `from` label arrived with the state.
export function libraryLabelForUrl(url) {
  if (!url) return 'Library';
  const q = url.indexOf('?');
  if (q < 0) return 'Library';
  try {
    const params = new URLSearchParams(url.slice(q + 1));
    const tab = params.get('tab');
    return (tab && LIBRARY_TAB_LABEL[tab]) || 'Library';
  } catch {
    return 'Library';
  }
}

// Map the current page's pathname to a sensible back-link label so a
// shortcut-driven navigation (R → BookDetail, palette → anywhere)
// reads "← Authors" / "← Stats" / "← Library" appropriately on the
// destination page. Anything unrecognised falls back to "Library".
export function labelForPath(pathname) {
  if (pathname === '/')                 return 'Library';
  // /browse/* used to collapse to 'Library' too — convenient but
  // misleading, since back-link labels then point at /browse/X
  // ("← Library" → /browse/year_acquired/2026). The browse page itself
  // already produces a rich fromState ("Acquired 2026") for its own
  // outgoing card Links, so this only matters for surfaces that
  // synthesise their own from-label (Nav's + Add book, R shortcut,
  // palette random book). 'Browse' is generic but honest.
  //
  // Year fields mirror BrowsePage's rich label because the raw value
  // is ambiguous off-page ("2026" alone doesn't say acquired vs
  // finished). Other browse paths have self-identifying values
  // (audiobook, male, 4.5) and degrade to 'Browse' fine.
  if (pathname.startsWith('/browse/year_acquired/')) {
    return `Acquired ${decodeURIComponent(pathname.split('/').at(-1))}`;
  }
  if (pathname.startsWith('/browse/year_finished/')) {
    return `Finished ${decodeURIComponent(pathname.split('/').at(-1))}`;
  }
  if (pathname.startsWith('/browse'))   return 'Browse';
  if (pathname.startsWith('/stats'))    return 'Stats';
  if (pathname.startsWith('/authors'))  return 'Authors';
  if (pathname.startsWith('/tags'))     return 'Tags';
  if (pathname.startsWith('/series'))   return 'Series';
  if (pathname.startsWith('/loved'))    return 'Loved';
  if (pathname.startsWith('/readlist')) return 'Readlist';
  if (pathname.startsWith('/lists'))    return 'Lists';
  if (pathname.startsWith('/diary'))    return 'Diary';
  if (pathname.startsWith('/collage'))  return 'Collage';
  if (pathname.startsWith('/audit'))    return 'Audit';
  if (pathname.startsWith('/shelf'))    return 'Shelves';
  return 'Library';
}

// Up to 3-letter initials for skeleton tiles / covers / portraits when
// the image is missing. Strips a leading article ("the", "a", "an") on
// titles so "The Dispossessed" → "D" not "T". Mononyms ("Plato") fall
// through as one letter. Used everywhere a book cover or author
// portrait can be absent — keeps the placeholder informative without
// requiring the layout to also render a text label.
export function initialsFor(label) {
  if (!label) return '·';
  const stripped = label.replace(/^(the|a|an)\s+/i, '');
  const tokens = stripped.split(/\s+/).filter(Boolean);
  const letters = tokens.map(t => t[0]).filter(c => /[A-Za-z]/.test(c)).slice(0, 3);
  return letters.length ? letters.join('').toUpperCase() : (stripped[0] || '·');
}

// Diacritic-folding lowercase. Mirrors the server's `nrm()` in db.js so
// client-side text filters (AuthorsIndex / SeriesIndex / TagsIndex query
// boxes) match the same shape the CommandPalette search does — typing
// "bohm" finds "Böhm-Bawerk", "lem" finds "Stanisław Lem", "etienne"
// finds "Étienne de La Boétie". NFD + strip combining marks handles most
// cases; the explicit fold list covers a handful of non-decomposing
// ligatures and stroke-letters (Slavic ł / đ, etc.). Cheap enough to run
// per-row at this scale.
export function nrm(s) {
  if (s == null) return '';
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
    .replace(/ø/g, 'o').replace(/ð/g, 'd').replace(/þ/g, 'th')
    .replace(/ł/g, 'l').replace(/đ/g, 'd');
}
