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
// Mirror of FILTER_ARRAY_KEYS in ./filters.js — both lists must include
// every multi-select filter or chip clicks become silent no-ops
// (writeFiltersToParams skips unknown keys, so the URL never updates
// and the URL-derived filter state never picks the new value back up).
const FILTER_ARRAY_KEYS = ['missing', 'formats', 'fictions', 'sourceTypes', 'bindings', 'ratings', 'publishers', 'sources', 'series', 'originalLanguages', 'editionLanguages', 'tags', 'statuses'];
// Tristate fields ('owned', etc.) are encoded only when set — null
// means "no filter", which doesn't need a param. Empty string is also
// treated as "not set" to be forgiving.
const TRISTATE_KEYS = ['owned', 'previouslyOwned', 'custom', 'loved', 'stub'];

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
  const progress = searchParams.get('progress');
  if (progress === 'any') filters.progress = 'any';
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
  params.delete('progress');
  if (filters.progress) params.set('progress', filters.progress);
  return params;
}

// Order-aware deep equality on the filter shape. Used by setFilters
// to skip no-op URL writes when pruneFilters returns the same content.
// Comparing URL strings instead would false-positive on non-canonical
// param orders (URL written by something other than writeFiltersToParams,
// e.g. typed by the user) — writeFiltersToParams normalises order, so
// the same-content rewrite still differs as strings. Comparing the
// filter objects directly avoids that trap.
export function filtersEqual(a, b) {
  for (const k of FILTER_ARRAY_KEYS) {
    const aa = a[k] || [], bb = b[k] || [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  }
  if ((a.tagsMode || 'all') !== (b.tagsMode || 'all')) return false;
  for (const k of TRISTATE_KEYS) {
    if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  }
  if ((a.progress ?? null) !== (b.progress ?? null)) return false;
  return true;
}

