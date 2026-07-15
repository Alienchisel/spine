export const PAGE_SIZE = 48;

// Valid book statuses after migration 047 retired 'paused'. Used by
// pruneFilters to drop a stale 'paused' that an old sessionStorage may
// still carry — without this, the filter would persist invisibly (no
// matching chip in FilterPanel) and ship `status IN ('paused')` into
// the API, yielding an empty result with no clearable filter UI.
const VALID_STATUSES = new Set(['reading', 'finished', 'unread']);

export const EMPTY_FILTERS = {
  missing:           [],
  formats:           [],
  // fictions: 'fiction' | 'nonfiction' | 'empty' (unset). Multi-select
  // shape parallel to formats — the fiction column is a small tristate
  // and the filter is a subset of {fic, non-fic, unset}.
  fictions:          [],
  // sourceTypes: 'primary' | 'secondary' | 'empty'. Only meaningful for
  // non-fiction (validation nulls source_type on fiction rows); the
  // filter is not gated, so a primary+fiction combo returns zero.
  sourceTypes:       [],
  // bindings: 'paperback' | 'hardcover' | 'other' | 'empty'. Physical-
  // book partition; ebooks/audiobooks all report empty.
  bindings:          [],
  ratings:           [],
  publishers:        [],
  sources:           [],
  series:            [],
  originalLanguages: [],
  editionLanguages:  [],
  tags:              [],
  statuses:          [],
  // 'all' = require every selected tag (default; matches the search-bar AND
  // semantic). 'any' = match any selected tag (the multi-select-facet OR
  // semantic, opt-in via the All/Any toggle in FilterPanel). Only meaningful
  // when 2+ real tags are selected.
  tagsMode:        'all',
  owned:           null,
  previouslyOwned: null,
  custom:          null,
  loved:           null,
  // is_stub = wishlist placeholder. true = filter to stubs only,
  // false = exclude stubs. UI exposes only the true side as a single
  // "On wishlist" pill (mirrors the Loved / Custom convention).
  stub:            null,
  // 'any' = books with any logged reading activity (finished, in-progress,
  // or prior read on record). null = no filter. Currently only set by the
  // Stats-page hero strip's URL — no FilterPanel control yet.
  progress:        null,
};

const FILTER_ARRAY_KEYS = ['missing', 'formats', 'fictions', 'sourceTypes', 'bindings', 'ratings', 'publishers', 'sources', 'series', 'originalLanguages', 'editionLanguages', 'tags', 'statuses'];
const TRISTATE_KEYS = ['owned', 'previouslyOwned', 'custom', 'loved', 'stub'];

// Hardens persisted filter shape against (a) future schema migrations
// where a field type changes and the saved blob predates the change,
// and (b) hand-edited sessionStorage. Spine itself never writes a
// wrong-typed filter, but FilterPanel / pruneFilters / buildApiParams
// all do array operations on these fields, and a string-where-array
// would crash. Mirrors the VALID_TABS and pruneFilters defenses
// elsewhere in this file. Fields not in the schema are dropped.
export function normalizeFilters(saved) {
  const out = { ...EMPTY_FILTERS };
  if (!saved || typeof saved !== 'object') return out;
  for (const key of FILTER_ARRAY_KEYS) {
    if (Array.isArray(saved[key])) out[key] = saved[key];
  }
  if (saved.tagsMode === 'all' || saved.tagsMode === 'any') out.tagsMode = saved.tagsMode;
  for (const key of TRISTATE_KEYS) {
    if (saved[key] === true || saved[key] === false || saved[key] === null) out[key] = saved[key];
  }
  if (saved.progress === 'any') out.progress = 'any';
  return out;
}

export function countFilters(f) {
  return f.missing.length + f.formats.length + (f.fictions?.length || 0) +
    (f.sourceTypes?.length || 0) + (f.bindings?.length || 0) + f.ratings.length +
    f.publishers.length + f.sources.length + f.series.length +
    (f.originalLanguages?.length || 0) + (f.editionLanguages?.length || 0) +
    f.tags.length +
    (f.statuses?.length || 0) +
    (f.owned !== null ? 1 : 0) + (f.previouslyOwned !== null ? 1 : 0) +
    (f.custom !== null ? 1 : 0) + (f.loved !== null ? 1 : 0) +
    (f.stub !== null ? 1 : 0) +
    (f.progress != null ? 1 : 0);
}

// Tabs whose query hard-excludes wishlist stubs (`unread` — see
// lib/books/filters.js:93) or conceptually conflicts with them
// (`reading` / `finished` — a placeholder isn't something you're
// reading or finished with). Mirrors STATUS_TABS_HIDING_STATUS_FILTER
// in components/FilterPanel.jsx — kept parallel so the pill hide and
// the filter prune agree on the same set.
const STUB_INCOMPATIBLE_TABS = new Set(['reading', 'finished', 'unread']);

// Drop selected values that no longer exist in the current facet set
// (e.g. switching tabs may make a publisher selection meaningless).
// Also drops `stub=true` when the target tab hard-excludes stubs, so
// tabbing into Unread from Never-owned with the wishlist pill active
// doesn't leave the URL carrying a filter with no visible pill to
// clear (2026-07-15 sweep).
export function pruneFilters(filters, facets, tab) {
  const fmtSet   = new Set(facets.formats);
  const pubSet   = new Set(facets.publishers);
  const srcSet   = new Set(facets.sources || []);
  const serSet   = new Set(facets.series);
  const olangSet = new Set(facets.originalLanguages || []);
  const elangSet = new Set(facets.editionLanguages || []);
  const rtSet    = new Set(facets.ratings.map(String));
  const tagSet   = new Set(facets.tags);
  return {
    ...filters,
    formats:    filters.formats.filter(f => f === 'empty' ? facets.hasEmptyFormat    : fmtSet.has(f)),
    publishers: filters.publishers.filter(p => p === 'empty' ? facets.hasEmptyPublisher : pubSet.has(p)),
    sources:    (filters.sources || []).filter(s => s === 'empty' ? facets.hasEmptySource : srcSet.has(s)),
    series:     filters.series.filter(s => s === 'empty' ? facets.hasEmptySeries    : serSet.has(s)),
    originalLanguages: (filters.originalLanguages || []).filter(l =>
      l === 'empty' ? facets.hasEmptyOriginalLanguage : olangSet.has(l)),
    editionLanguages: (filters.editionLanguages || []).filter(l =>
      l === 'empty' ? facets.hasEmptyEditionLanguage : elangSet.has(l)),
    ratings:    filters.ratings.filter(r => r === 'empty' ? facets.hasEmptyRating    : rtSet.has(String(r))),
    tags:       filters.tags.filter(t => tagSet.has(t)),
    statuses:   (filters.statuses || []).filter(s => VALID_STATUSES.has(s)),
    stub:       (tab && STUB_INCOMPATIBLE_TABS.has(tab) && filters.stub === true) ? null : filters.stub,
  };
}

export function buildApiParams(tab, sort, filters, q, offset, seed, limit = PAGE_SIZE) {
  const p = { tab, sort, limit, offset };
  // Random sort needs a seed so pagination + refetches stay in sync — the
  // backend hashes (id, seed) into a stable order. Other sorts ignore it.
  if (sort === 'random' && seed != null) p.seed = String(seed);
  if (q) p.q = q;
  if (filters.missing.length)    p.missing        = filters.missing;
  if (filters.formats.length)    p.formats        = filters.formats;
  if (filters.fictions?.length)  p.fictions       = filters.fictions;
  if (filters.sourceTypes?.length) p.sourceTypes  = filters.sourceTypes;
  if (filters.bindings?.length)  p.bindings       = filters.bindings;
  if (filters.sources?.length)   p.sources        = filters.sources;
  if (filters.ratings.length)    p.ratings        = filters.ratings.map(String);
  if (filters.publishers.length) p.publishers     = filters.publishers;
  if (filters.series.length)     p.series         = filters.series;
  if (filters.originalLanguages?.length) p.originalLanguages = filters.originalLanguages;
  if (filters.editionLanguages?.length)  p.editionLanguages  = filters.editionLanguages;
  if (filters.tags.length)       p.tags           = filters.tags;
  if (filters.statuses?.length)  p.statuses       = filters.statuses;
  if (filters.tags.length > 1 && filters.tagsMode === 'any') p.tagsMode = 'any';
  if (filters.owned !== null)           p.owned           = String(filters.owned);
  if (filters.previouslyOwned !== null) p.previouslyOwned = String(filters.previouslyOwned);
  if (filters.custom !== null)          p.custom          = String(filters.custom);
  if (filters.loved !== null)           p.loved           = String(filters.loved);
  if (filters.stub !== null)            p.stub            = String(filters.stub);
  if (filters.progress)                 p.progress        = filters.progress;
  return p;
}
