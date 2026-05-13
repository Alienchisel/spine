// Library view state — tab, sort, query, filters — is encoded in the
// URL so a) refreshes preserve it without per-tab sessionStorage,
// b) filtered views are bookmarkable and shareable, and c) opening a
// book in a new tab can land back on the same filtered Library via
// document.referrer instead of an empty default view.
//
// UI preferences that aren't part of "this view" — sortByTab (per-tab
// sort memory), density (comfortable/compact), filtersOpen (panel
// expanded?) — stay in localStorage. Those are personal settings, not
// shareable state, and don't belong in the URL.

import { EMPTY_FILTERS, normalizeFilters } from './filters.js';

// Filter array values use repeated keys (`?tag=X&tag=Y`) so the URL
// reads naturally and each value composes into URLSearchParams.getAll().
const FILTER_ARRAY_KEYS = ['missing', 'formats', 'ratings', 'publishers', 'sources', 'series', 'tags', 'statuses'];
// Tristate fields ('owned', etc.) are encoded only when set — null
// means "no filter", which doesn't need a param. Empty string is also
// treated as "not set" to be forgiving.
const TRISTATE_KEYS = ['owned', 'previouslyOwned', 'custom', 'loved'];

export function paramsToFilters(searchParams) {
  const filters = { ...EMPTY_FILTERS };
  for (const key of FILTER_ARRAY_KEYS) {
    const values = searchParams.getAll(key);
    if (values.length) filters[key] = values;
  }
  const tagsMode = searchParams.get('tagsMode');
  if (tagsMode === 'any' || tagsMode === 'all') filters.tagsMode = tagsMode;
  for (const key of TRISTATE_KEYS) {
    const v = searchParams.get(key);
    if      (v === 'true')  filters[key] = true;
    else if (v === 'false') filters[key] = false;
  }
  // normalizeFilters does final shape validation (e.g. drops unknown
  // statuses), same guarantees as the old sessionStorage path. This
  // keeps the URL parser robust against hand-edited URLs too.
  return normalizeFilters(filters);
}

// Mutate a URLSearchParams in place to reflect the given filter set —
// deletes the corresponding keys and re-adds non-default values. The
// in-place mutation pattern matches react-router-dom's setSearchParams
// callback contract (which expects a URLSearchParams returned, but it
// reads from a new instance built off the callback's arg).
export function writeFiltersToParams(params, filters) {
  for (const key of FILTER_ARRAY_KEYS) {
    params.delete(key);
    for (const v of (filters[key] || [])) params.append(key, v);
  }
  params.delete('tagsMode');
  if (filters.tagsMode && filters.tagsMode !== 'all') params.set('tagsMode', filters.tagsMode);
  for (const key of TRISTATE_KEYS) {
    params.delete(key);
    if (filters[key] === true)  params.set(key, 'true');
    if (filters[key] === false) params.set(key, 'false');
  }
  return params;
}

// Convenience: produce a fresh URLSearchParams reflecting the given
// view state. Used when fully replacing the URL (e.g. tab switch
// re-keys sort from per-tab memory).
export function buildLibraryParams({ tab, sort, query, filters, custom }) {
  const params = new URLSearchParams();
  if (tab && tab !== 'reading') params.set('tab', tab);
  if (sort && sort !== 'updated') params.set('sort', sort);
  if (query) params.set('q', query);
  // The `?custom=true|false` deep-link from the Stats Custom tile
  // round-trips through here so callers can build a fully-formed URL
  // without losing the custom hint.
  if (custom === true)  params.set('custom', 'true');
  if (custom === false) params.set('custom', 'false');
  writeFiltersToParams(params, filters || EMPTY_FILTERS);
  return params;
}
