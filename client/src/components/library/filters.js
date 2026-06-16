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
  // 'any' = books with any logged reading activity (finished, in-progress,
  // or prior read on record). null = no filter. Currently only set by the
  // Stats-page hero strip's URL — no FilterPanel control yet.
  progress:        null,
};

const FILTER_ARRAY_KEYS = ['missing', 'formats', 'ratings', 'publishers', 'sources', 'series', 'originalLanguages', 'editionLanguages', 'tags', 'statuses'];
const TRISTATE_KEYS = ['owned', 'previouslyOwned', 'custom', 'loved'];

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
  return f.missing.length + f.formats.length + f.ratings.length +
    f.publishers.length + f.sources.length + f.series.length +
    (f.originalLanguages?.length || 0) + (f.editionLanguages?.length || 0) +
    f.tags.length +
    (f.statuses?.length || 0) +
    (f.owned !== null ? 1 : 0) + (f.previouslyOwned !== null ? 1 : 0) +
    (f.custom !== null ? 1 : 0) + (f.loved !== null ? 1 : 0) +
    (f.progress != null ? 1 : 0);
}

// Drop selected values that no longer exist in the current facet set
// (e.g. switching tabs may make a publisher selection meaningless).
export function pruneFilters(filters, facets) {
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
  if (filters.progress)                 p.progress        = filters.progress;
  return p;
}
