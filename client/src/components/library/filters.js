export const PAGE_SIZE = 48;

export const EMPTY_FILTERS = {
  missing:         [],
  formats:         [],
  ratings:         [],
  publishers:      [],
  sources:         [],
  series:          [],
  tags:            [],
  owned:           null,
  previouslyOwned: null,
  custom:          null,
  loved:           null,
};

export function countFilters(f) {
  return f.missing.length + f.formats.length + f.ratings.length +
    f.publishers.length + f.sources.length + f.series.length + f.tags.length +
    (f.owned !== null ? 1 : 0) + (f.previouslyOwned !== null ? 1 : 0) +
    (f.custom !== null ? 1 : 0) + (f.loved !== null ? 1 : 0);
}

// Drop selected values that no longer exist in the current facet set
// (e.g. switching tabs may make a publisher selection meaningless).
export function pruneFilters(filters, facets) {
  const fmtSet  = new Set(facets.formats);
  const pubSet  = new Set(facets.publishers);
  const srcSet  = new Set(facets.sources || []);
  const serSet  = new Set(facets.series);
  const rtSet   = new Set(facets.ratings.map(String));
  const tagSet  = new Set(facets.tags);
  return {
    ...filters,
    formats:    filters.formats.filter(f => f === 'empty' ? facets.hasEmptyFormat    : fmtSet.has(f)),
    publishers: filters.publishers.filter(p => p === 'empty' ? facets.hasEmptyPublisher : pubSet.has(p)),
    sources:    (filters.sources || []).filter(s => srcSet.has(s)),
    series:     filters.series.filter(s => s === 'empty' ? facets.hasEmptySeries    : serSet.has(s)),
    ratings:    filters.ratings.filter(r => r === 'empty' ? facets.hasEmptyRating    : rtSet.has(String(r))),
    tags:       filters.tags.filter(t => tagSet.has(t)),
  };
}

export function buildApiParams(tab, sort, filters, q, offset) {
  const p = { tab, sort, limit: PAGE_SIZE, offset };
  if (q) p.q = q;
  if (filters.missing.length)    p.missing        = filters.missing;
  if (filters.formats.length)    p.formats        = filters.formats;
  if (filters.sources?.length)   p.sources        = filters.sources;
  if (filters.ratings.length)    p.ratings        = filters.ratings.map(String);
  if (filters.publishers.length) p.publishers     = filters.publishers;
  if (filters.series.length)     p.series         = filters.series;
  if (filters.tags.length)       p.tags           = filters.tags;
  if (filters.owned !== null)           p.owned           = String(filters.owned);
  if (filters.previouslyOwned !== null) p.previouslyOwned = String(filters.previouslyOwned);
  if (filters.custom !== null)          p.custom          = String(filters.custom);
  if (filters.loved !== null)           p.loved           = String(filters.loved);
  return p;
}
