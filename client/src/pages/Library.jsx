import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import { api } from '../api.js';
import { plural } from '../utils.js';
import BookCard from '../components/BookCard.jsx';
import FilterPanel from '../components/FilterPanel.jsx';
import SearchHelp from '../components/SearchHelp.jsx';
import SeriesCard from '../components/library/SeriesCard.jsx';
import { EMPTY_FILTERS, PAGE_SIZE, countFilters, pruneFilters, buildApiParams } from '../components/library/filters.js';
import { paramsToFilters, writeFiltersToParams, filtersEqual } from '../components/library/urlState.js';
import { buildDisplayItems } from '../components/library/grouping.js';
import { useCoverSize } from '../hooks/useCoverSize.js';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import { GridSkeleton } from '../components/Skeleton.jsx';
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query';
import { useLatest } from '../hooks/useLatest.js';
import { useSpineEvent, dispatchSpineEvent } from '../hooks/useSpineEvent.js';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { useEscapeKey } from '../hooks/useEscapeKey.js';

const TABS = [
  { key: 'reading',     label: 'Reading' },
  { key: 'finished',    label: 'Finished' },
  { key: 'unread',      label: 'Unread' },
  { key: 'owned',       label: 'Owned' },
  { key: 'prev_owned',  label: 'Prev. owned' },
  { key: 'never_owned', label: 'Never owned' },
  { key: 'all',         label: 'All' },
  { key: 'archived',    label: 'Archived' },
];

// Archival views folded into the mobile "More ▾" menu. Below sm the
// full 8-tab strip sums to ~600 px against a ~390 px viewport — the
// overflow-x-auto backstop made it scrollable, but the folded tabs
// lived off-screen with no affordance that they existed. Desktop (sm+)
// still shows the full strip; the fold is presentation-only, so URL
// state, per-tab sort memory, and VALID_TABS are untouched.
const MORE_TAB_KEYS = new Set(['prev_owned', 'never_owned', 'archived']);
const MORE_TABS = TABS.filter(t => MORE_TAB_KEYS.has(t.key));

// localStorage holds only UI preferences that aren't part of "this
// view": per-tab sort memory, filter-panel open state. Cover-size
// has its own key (spine-cover-size) via useCoverSize so other
// cover-first grids can share it. View state (tab/sort/query/filters)
// lives in the URL — see urlState.js.
const PREFS_KEY = 'spine-library-prefs';

const SORTS = [
  { key: 'updated',     label: 'Recently updated' },
  { key: 'last_logged', label: 'Recently logged' },
  { key: 'added',       label: 'Recently added' },
  { key: 'acquired',    label: 'Recently acquired' },
  { key: 'author',      label: 'Author A–Z' },
  { key: 'title',       label: 'Title A–Z' },
  { key: 'rating',      label: 'Rating' },
  { key: 'progress',    label: 'Progress' },
  { key: 'started',     label: 'Date started' },
  { key: 'finished',    label: 'Date finished' },
  { key: 'length',      label: 'Length' },
  // Duration is only meaningful when audiobooks can appear in the
  // listing — gated below in the dropdown render against filters.formats.
  // (If the user has the saved sort but narrows the format filter to
  // exclude audiobooks, the sort still works server-side; it just
  // sorts other formats as 0 minutes at the bottom.)
  { key: 'duration',    label: 'Duration', requiresAudiobook: true },
  { key: 'random',      label: 'Random' },
];

function rollSeed() {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}

// Clamp sortByTab values that no longer make sense — either because the
// sort was renamed/removed since the session was persisted, or because the
// saved value lives under a tab where the sort isn't allowed (the dropdown
// hides it but the underlying value would otherwise still ship to the API,
// invisibly miscategorizing the result set).
function sortAllowedForTab(sort, tab) {
  const def = SORTS.find(s => s.key === sort);
  if (!def) return 'updated';
  if (def.tabs && !def.tabs.includes(tab)) return 'updated';
  return sort;
}

function getPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; }
  catch { return {}; }
}

function FilterIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M2 4a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 3.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
    </svg>
  );
}

// Three horizontal sliders — the universal "adjustments / settings"
// icon. Used for the mobile View-options button.
function SlidersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="2"  y1="4"  x2="9"  y2="4"  />
      <line x1="13" y1="4"  x2="14" y2="4"  />
      <circle cx="11" cy="4"  r="1.5" fill="currentColor" stroke="none" />
      <line x1="2"  y1="8"  x2="4"  y2="8"  />
      <line x1="8"  y1="8"  x2="14" y2="8"  />
      <circle cx="6"  cy="8"  r="1.5" fill="currentColor" stroke="none" />
      <line x1="2"  y1="12" x2="10" y2="12" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const VALID_TABS = new Set(['reading', 'finished', 'unread', 'owned', 'prev_owned', 'never_owned', 'all', 'archived']);

export default function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Captured here so every setSearchParams call below can pass it
  // through; react-router-dom does NOT preserve location.state across
  // navigations by default, so a tab/sort/filter/search-input change
  // would otherwise wipe the '← Stats' (or whatever) incoming back
  // link the moment the user touches a control.
  const { state: navState, search: locationSearch } = useLocation();
  // useMemo with [] keeps the localStorage read + JSON.parse to a single
  // mount-time cost. Previously this ran on every render even though
  // only the three useState lazy initializers below consume it.
  const prefs = useMemo(() => getPrefs(), []);

  // ── URL-derived view state (tab/sort/query/filters) ────────────────
  // tab/sort/query/filters all derive from searchParams. setters mutate
  // the URL, which triggers a re-render with the new values. The URL is
  // the single source of truth so refreshes preserve state and the
  // current location.search round-trips back to the same view.
  const urlTab = searchParams.get('tab');
  const tab = (urlTab && VALID_TABS.has(urlTab)) ? urlTab : 'reading';
  const query = searchParams.get('q') || '';
  const filters = useMemo(() => paramsToFilters(searchParams), [searchParams]);

  // ── Local UI preferences (don't belong in URL) ─────────────────────
  // Per-tab sort memory in localStorage so switching tabs restores the
  // tab's last-used sort. Density and filtersOpen are personal display
  // preferences — also localStorage so they survive across tabs.
  const [sortByTab, setSortByTab] = useState(() => {
    return (prefs.sortByTab && typeof prefs.sortByTab === 'object') ? prefs.sortByTab : {};
  });
  const [filtersOpen, setFiltersOpen] = useState(() => typeof prefs.filtersOpen === 'boolean' ? prefs.filtersOpen : false);
  // Mobile-only View options sheet — collapses set-and-forget controls
  // (the cover-size slider, for now) behind a single button so the
  // inline toolbar can fit on a ~390 px viewport without horizontal
  // scroll. Desktop renders the slider inline as before.
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  // Cover-size dial — Plex-style 9-stop slider. Stored under its own
  // localStorage key (not in library prefs) so other cover-first grids
  // (Loved, ShelfView, BrowsePage) can share it on a later pass.
  const { size: coverSize, setSize: setCoverSize, cols: coverCols, compact, gridStyle, gridClassName, MIN: coverMin, MAX: coverMax } = useCoverSize();

  // Sort is URL-encoded but defaults to the per-tab remembered sort
  // when absent. This preserves the "each tab has its own preferred
  // sort" feature while keeping bookmark URLs that explicitly set
  // `?sort=...` authoritative.
  const urlSort = searchParams.get('sort');
  const sort = sortAllowedForTab(urlSort || sortByTab[tab], tab);

  // Setters: each one mutates the URL. We keep a useState `queryRaw`
  // for the search-box value so typing isn't bottlenecked on URL
  // updates — the debounced effect below writes to the URL.
  function setTab(value) {
    const resolved = typeof value === 'function' ? value(tab) : value;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (resolved === 'reading') next.delete('tab'); else next.set('tab', resolved);
      // When switching tabs, also re-key sort to the new tab's remembered
      // sort so the dropdown swaps to that tab's last choice. Strip any
      // explicit ?sort= from the URL — falling back to sortByTab[newTab]
      // is the intended behaviour and an explicit param would override
      // it on every subsequent URL push.
      next.delete('sort');
      return next;
    }, { state: navState });
  }
  function setFilters(value) {
    const current = paramsToFilters(searchParams);
    const resolved = typeof value === 'function' ? value(current) : value;
    // Skip the navigation when filters didn't change — pruneFilters
    // on tab change calls setFilters even when the result is identical
    // (overlapping facets), which would otherwise push a redundant
    // history entry for every tab switch. Compare the filter objects
    // directly so non-canonical URL param orders don't fool the check.
    if (filtersEqual(current, resolved)) return;
    // Collapse series expansion state on filter change. Without this, a
    // user-expanded series can outlive the filter that left it visible
    // and re-appear pre-expanded once an un-filter brings it back —
    // tab and sort changes already clear; doing it here for filters too
    // keeps the behaviour consistent.
    setExpandedSeries(new Set());
    const next = new URLSearchParams(searchParams);
    writeFiltersToParams(next, resolved);
    setSearchParams(next, { state: navState });
  }
  // Random-sort seed rides in the URL as `?seed=N` so back-navigation
  // from a BookDetail restores the same shuffle instead of remounting
  // with a fresh roll (2026-07-14 report — Library remounted, useState
  // fired again, order changed). Initializer reads the URL first and
  // falls back to a fresh roll; a synchronisation effect below keeps
  // the URL in step with the state (writing on switch-into-random or
  // die-button re-roll, deleting on switch-away-from-random). The die
  // button still explicitly re-rolls without reload.
  const [randomSeed, setRandomSeed] = useState(() => {
    const fromUrl = Number(searchParams.get('seed'));
    return Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : rollSeed();
  });
  useEffect(() => {
    const current = searchParams.get('seed');
    const wanted  = sort === 'random' ? String(randomSeed) : null;
    if (current === wanted) return;
    const next = new URLSearchParams(searchParams);
    if (wanted) next.set('seed', wanted); else next.delete('seed');
    setSearchParams(next, { replace: true, state: navState });
    // searchParams is a fresh instance each render — depending on it
    // would re-fire this effect on any URL change. Sort + randomSeed
    // are the actual triggers; the effect reads searchParams as an
    // out-of-band snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, randomSeed]);
  function setSort(value) {
    const resolved = typeof value === 'function' ? value(sort) : value;
    setSortByTab(prev => ({ ...prev, [tab]: resolved }));
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (resolved === 'updated') next.delete('sort'); else next.set('sort', resolved);
      return next;
    }, { state: navState });
    // Re-roll on switch INTO random so the user sees a fresh shuffle
    // (otherwise the same seed would carry forward from a prior random
    // tab, which feels stale).
    if (resolved === 'random' && sort !== 'random') setRandomSeed(rollSeed());
  }
  // Search-box value is kept in local state so each keystroke is
  // responsive; a 300ms debounce flushes the value to the URL. URL
  // writes use replace:true so typing doesn't spam the history stack.
  const [queryRaw, setQueryRaw] = useState(query);
  // Series expansion state — set of series names the user has clicked
  // open. Declared here (before the paginated fetch) so the density
  // effect below can read the current value when it decides whether
  // to keep fetching to fill a sparse grid.
  const [expandedSeries, setExpandedSeries] = useState(new Set());

  // Paginated visible-books fetch, powered by TanStack Query's
  // useInfiniteQuery. Cache is keyed on the full view state
  // (tab / sort / filters / query / randomSeed) — a real change of
  // any of them is a new cache entry (skeleton flash on first mount
  // of that key, instant restore on revisit within the 30-min
  // gcTime). Tabbing away and back is a no-op on the same view.
  //
  // The density-based stopWhen from the old usePaginatedFetch is
  // replaced by the sparse-view density effect below — after the
  // initial page lands, keep fetching until the visible grid has
  // enough display items to fill at least one row.
  const queryClient = useQueryClient();
  const queryKey = ['library', tab, sort, filters, query, randomSeed];
  const booksQ = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 0 }) =>
      api.getBooks(buildApiParams(tab, sort, filters, query, pageParam, randomSeed, PAGE_SIZE))
        .then(r => ({ books: r.books, total: r.total, offset: pageParam })),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.offset + lastPage.books.length;
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
  const books = useMemo(
    () => booksQ.data?.pages.flatMap(p => p.books) ?? [],
    [booksQ.data],
  );
  const total       = booksQ.data?.pages.at(-1)?.total ?? 0;
  const loading     = booksQ.isPending;
  const loadingMore = booksQ.isFetchingNextPage;
  const hasMore     = !!booksQ.hasNextPage;
  const loadedCount = books.length;
  const fetchError  = booksQ.error;
  const [actionError, setActionError] = useState(null);
  const [loadingAll,  setLoadingAll]  = useState(false);
  const loadMore = useCallback(async () => {
    if (booksQ.isFetchingNextPage) return;
    setActionError(null);
    try { await booksQ.fetchNextPage(); }
    catch (e) { setActionError(e); }
  }, [booksQ]);
  const loadAll = useCallback(async () => {
    if (loadingAll || booksQ.isFetchingNextPage) return;
    setLoadingAll(true);
    setActionError(null);
    try {
      // Loop until getNextPageParam returns undefined. Reading
      // hasNextPage directly off the query is safe here because
      // fetchNextPage awaits its own state settle before returning.
      while (booksQ.hasNextPage) {
        await booksQ.fetchNextPage();
      }
    } catch (e) {
      setActionError(e);
    } finally {
      setLoadingAll(false);
    }
  }, [booksQ, loadingAll]);
  // Optimistic setters mirror the old usePaginatedFetch API shape.
  // useInfiniteQuery stores data as { pages: [...], pageParams: [...] };
  // we collapse into a single synthetic page since the paginated
  // structure isn't observable to consumers of `books`. Guards
  // against undefined cache (see the setter-shims commit).
  const setBooks = useCallback((updater) => {
    queryClient.setQueryData(queryKey, (data) => {
      if (!data) return data;
      const flat = data.pages.flatMap(p => p.books);
      const newFlat = typeof updater === 'function' ? updater(flat) : updater;
      const lastTotal = data.pages.at(-1)?.total ?? newFlat.length;
      return {
        pages: [{ books: newFlat, total: lastTotal, offset: 0 }],
        pageParams: [0],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, ...queryKey]);
  const setTotal = useCallback((updater) => {
    queryClient.setQueryData(queryKey, (data) => {
      if (!data) return data;
      const flat = data.pages.flatMap(p => p.books);
      const lastTotal = data.pages.at(-1)?.total ?? 0;
      const newTotal = typeof updater === 'function' ? updater(lastTotal) : updater;
      return {
        pages: [{ books: flat, total: newTotal, offset: 0 }],
        pageParams: [0],
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, ...queryKey]);
  // setLoadedCount is a no-op — the count derives from books.length now.
  // Kept as an identity for callers that still invoke it after in-place
  // deletion (which already shrinks books via setBooks).
  const setLoadedCount = useCallback(() => {}, []);
  // Sparse-view density effect — replaces the old usePaginatedFetch
  // stopWhen. After the initial page lands, keep fetching until the
  // visible grid has at least one full row of display items.
  useEffect(() => {
    if (loading || loadingMore || loadingAll) return;
    if (!hasMore) return;
    const visible = buildDisplayItems(books, expandedSeries).length;
    if (visible < Math.max(coverCols, 1)) {
      booksQ.fetchNextPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, sort, expandedSeries, coverCols, hasMore, loading, loadingMore, loadingAll]);
  // Library-wide series totals, keyed by series name → book_count, so the
  // SeriesCard badge can render "13/25" when the current view has only
  // loaded part of a series instead of misleadingly showing just "13" as
  // if that were the series' size. Shares its cache with SeriesIndex's
  // ['series', 'all'] query. Failure is silent — the badge falls back to
  // the loaded count.
  const seriesTotalsQ = useQuery({
    queryKey: ['series', 'all'],
    queryFn: () => api.getSeries(),
  });
  const seriesTotals = useMemo(
    () => new Map((seriesTotalsQ.data || []).map(r => [r.name, r.book_count])),
    [seriesTotalsQ.data]
  );
  const prevTabRef = useRef(null);
  const searchRef  = useRef(null);
  const tabRefs = useRef([]);

  // Mobile "More ▾" tab menu — portal + fixed positioning + mousedown/
  // scroll/Escape close, mirroring MoreMenu's popover idiom (the strip's
  // overflow-x-auto wrapper would clip an absolutely-positioned child).
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos]   = useState(null);
  const moreBtnRef  = useRef(null);
  const moreMenuRef = useRef(null);
  useClickOutside([moreBtnRef, moreMenuRef], () => setMoreOpen(false), moreOpen);
  useEscapeKey(() => { setMoreOpen(false); moreBtnRef.current?.focus(); }, moreOpen);
  useEffect(() => {
    if (!moreOpen) return;
    function onScroll(e) {
      if (moreMenuRef.current?.contains(e.target)) return;
      setMoreOpen(false);
    }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [moreOpen]);
  function toggleMoreMenu() {
    if (moreOpen) { setMoreOpen(false); return; }
    const rect = moreBtnRef.current.getBoundingClientRect();
    // Right-align the menu to the trigger (it sits at the strip's right
    // edge), clamped inside the viewport. Width mirrors min-w-40.
    const MENU_WIDTH = 160;
    const left = Math.min(Math.max(rect.right - MENU_WIDTH, 8), window.innerWidth - MENU_WIDTH - 8);
    setMorePos({ top: rect.bottom + 4, left });
    setMoreOpen(true);
  }

  function switchTab(key) {
    setTab(key);
    setExpandedSeries(new Set());
  }

  function handleTabKey(e, idx) {
    // Arrow/Home/End roving moves through VISIBLE tabs only — below sm
    // the MORE_TAB_KEYS buttons are display:none (folded into the More
    // menu) and focus() on a hidden element silently no-ops, which
    // would strand the roving tabindex. offsetParent is null for
    // display:none elements, so it doubles as the visibility probe.
    const visible = TABS.map((_, i) => i)
      .filter(i => tabRefs.current[i]?.offsetParent !== null);
    if (visible.length === 0) return;
    const pos = visible.indexOf(idx);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = visible[(pos + dir + visible.length) % visible.length];
      switchTab(TABS[next].key);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      switchTab(TABS[visible[0]].key);
      tabRefs.current[visible[0]]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = visible[visible.length - 1];
      switchTab(TABS[last].key);
      tabRefs.current[last]?.focus();
    }
  }
  // Refs mirroring the latest tab + sort. handleProgressUpdate is invoked
  // asynchronously by BookCard after its PUT resolves; if the user
  // switched tabs mid-flight, the function's closure-captured tab would
  // be stale and could remove a book from the NEW tab's freshly-fetched
  // list. Reading from refs ensures the latest values are used regardless
  // of which render's function instance gets invoked.
  const tabRef  = useLatest(tab);
  const sortRef = useLatest(sort);

  // Bridge for the command palette's Load more / Load all entries — the
  // refs themselves are declared further down (where the handler /
  // paging-state values exist), but the listener effect below references
  // them via closure. JS hoists the const bindings and the closures only
  // read .current after commit, by which point useLatest has populated it.

  // Bridge to the command palette: respond to a paging-state request and
  // wire its Load more / Load all entries to the hook's loadMore/loadAll.
  // The hook's handlers have stable identity (useCallback'd internally),
  // so the subscription doesn't need a ref bounce.
  useSpineEvent('spine:library-paging-request', () => {
    dispatchSpineEvent('spine:library-paging', pagingStateRef.current);
  });
  useSpineEvent('spine:library-load-more', loadMore);
  useSpineEvent('spine:library-load-all',  loadAll);

  // '/' focuses search
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Debounce search query → URL. replace:true so each keystroke
  // overwrites the URL in history instead of pushing a new entry
  // (otherwise the back button would step through every character).
  useEffect(() => {
    if (queryRaw === query) return;
    const timer = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        if (queryRaw) next.set('q', queryRaw); else next.delete('q');
        return next;
      }, { replace: true, state: navState });
    }, 300);
    return () => clearTimeout(timer);
  }, [queryRaw, query, setSearchParams]);

  // Sync URL → local search-box value. Catches back/forward navigation
  // and external URL changes; the early-return in the debounce effect
  // above ensures this doesn't trigger a feedback loop on user typing.
  // Skip when the search input is focused so external URL changes
  // can't clobber a user's in-progress typing — their debounce will
  // still flush whatever they end up with.
  useEffect(() => {
    if (document.activeElement === searchRef.current) return;
    setQueryRaw(query);
  }, [query]);

  // Mirror URL-explicit sort into sortByTab so a bookmarked URL like
  // `/?tab=all&sort=author` registers in per-tab memory. Without this
  // sync, switching tabs and back would lose the URL-driven sort
  // because setTab strips ?sort= and the fallback (sortByTab[tab])
  // would still be empty.
  useEffect(() => {
    if (!urlSort) return;
    if (sortAllowedForTab(urlSort, tab) !== urlSort) return;
    setSortByTab(prev => prev[tab] === urlSort ? prev : { ...prev, [tab]: urlSort });
  }, [urlSort, tab]);

  // Persist UI preferences (sort memory, filter-panel state) to
  // localStorage so they survive across tabs and sessions. Cover-size
  // is stored under its own key by useCoverSize. View state
  // (tab/sort/query/filters) lives in the URL, not here.
  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sortByTab, filtersOpen }));
  }, [sortByTab, filtersOpen]);

  // Tab counts badge — one query per session, invalidated by the
  // global spine-event bridge on any book mutation. No focus refetch
  // (staleTime: Infinity in queryClient.js).
  const countsQ = useQuery({
    queryKey: ['library-counts'],
    queryFn: () => api.getBookCounts(),
    placeholderData: (prev) => prev ?? {},
  });
  const counts      = countsQ.data ?? {};
  const countsError = countsQ.isError;

  // Facets — cached per view. Keeps previous facets visible during
  // transitions (no flicker on filter change). Tab-change prune runs
  // in a side effect once the new facets land.
  const facetsQ = useQuery({
    queryKey: ['library-facets', tab, sort, filters, query, randomSeed],
    queryFn: () => api.getBookFacets(buildApiParams(tab, sort, filters, query, 0, randomSeed)),
    placeholderData: (prev) => prev,
  });
  const facets      = facetsQ.data ?? null;
  const facetsError = facetsQ.isError;
  useEffect(() => {
    if (!facetsQ.data) return;
    const isTabChange = prevTabRef.current !== tab;
    prevTabRef.current = tab;
    if (isTabChange) setFilters(prev => pruneFilters(prev, facetsQ.data, tab));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facetsQ.data, tab]);

  // Cohort — the full view up to the 200 server cap, used by
  // BookDetail's prev/next threading. Same cache key shape as the
  // paginated fetch, so a view transition invalidates it in step.
  const cohortQ = useQuery({
    queryKey: ['library-cohort', tab, sort, filters, query, randomSeed],
    queryFn: () => api.getBooks(buildApiParams(tab, sort, filters, query, 0, randomSeed, 200))
      .then(({ books: b }) => b.map(x => ({ id: x.id, title: x.title }))),
    placeholderData: (prev) => prev ?? [],
  });
  const cohort = cohortQ.data ?? [];

  function handleProgressUpdate(updated) {
    // Read tab/sort from refs rather than closure: BookCard's PUT can
    // resolve hundreds of ms after the user clicked save, and they may
    // have switched tabs in the interim. Closure-captured `tab` would
    // then point at the old tab and incorrectly remove a book that now
    // legitimately belongs on the new one.
    const currentTab  = tabRef.current;
    const currentSort = sortRef.current;
    const statusTabs = ['reading', 'finished', 'unread'];
    const removing = statusTabs.includes(currentTab) && updated.status !== currentTab;
    if (removing) {
      // Bail if the book is no longer in local state — back-to-back
      // status patches (a finish auto-transition followed by another
      // edit) would otherwise double-decrement counters for a book
      // already filtered out. Clamps below back-stop the same desync.
      if (!books.some(b => b.id === updated.id)) return;
      setLoadedCount(n => Math.max(0, n - 1));
      setTotal(t => Math.max(0, t - 1));
      setBooks(bs => bs.filter(b => b.id !== updated.id));
    } else if (currentSort === 'updated') {
      // Mirror the server's `updated_at DESC` ordering locally so an inline
      // edit (rating, progress, finish) bumps the book to the top right away
      // instead of waiting for a refetch on next mount. The server skips
      // the write on no-op PATCHes (same current_page / current_minutes),
      // which leaves updated_at unchanged — only reorder when the server
      // confirms the bump, otherwise an idle save phantom-moves the row.
      setBooks(bs => {
        const prev = bs.find(b => b.id === updated.id);
        if (prev && prev.updated_at === updated.updated_at) {
          return bs.map(b => b.id === updated.id ? updated : b);
        }
        return [updated, ...bs.filter(b => b.id !== updated.id)];
      });
    } else {
      setBooks(bs => bs.map(b => b.id === updated.id ? updated : b));
    }
  }

  function toggleSeries(name) {
    setExpandedSeries(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const activeCount   = countFilters(filters);
  const allDisplayItems = buildDisplayItems(books, expandedSeries);
  // Back-link state for BookDetail: returning preserves the current Library
  // search params (filters / tab / sort) so the user lands on the same
  // filtered view they came from rather than the default Library root.
  // Memoised so every BookCard in the grid receives the same reference
  // until the URL actually changes.
  // cohort threads the current filter+sort view into BookDetail's navState
  // so prev/next walks the same view the user was scanning. Prefers the
  // separate cohort fetch (full view up to the 200 server cap); falls
  // back to the visible-books slice during the brief first-paint window
  // before the cohort lands. Flat — series-grouping is a display concern,
  // not a navigation one.
  const fromState = useMemo(() => {
    const qs = searchParams.toString();
    return {
      from: 'Library',
      fromPath: qs ? `/?${qs}` : '/',
      cohort: cohort.length > 0 ? cohort : books.map(b => ({ id: b.id, title: b.title })),
    };
  }, [searchParams, books, cohort]);
  const gridCols        = coverCols;

  // Publish paging state for the command palette to mirror. The hook's
  // loadMore/loadAll have stable identity so the spine event subscriptions
  // (above, on mount) wire to them directly — no loadHandlersRef bounce
  // needed any more.
  const pagingStateRef  = useLatest({ hasMore, loadingMore, loadingAll, loaded: loadedCount, total });
  useEffect(() => {
    dispatchSpineEvent('spine:library-paging', pagingStateRef.current);
  }, [hasMore, loadingMore, loadingAll, total]);
  // Mid-pagination, hide a trailing partial row so the visible grid always
  // ends on a full row of real books. The hidden stragglers re-emerge on the
  // next Load more when their row is filled in by fresh books. At end of
  // dataset, show everything — a partial last row is fine since there's
  // nothing more to load.
  // Guard: only trim when there's at least one full row to keep — otherwise
  // pathologically small loads (e.g. heavy series collapse → 5 items) would
  // hide everything and the user would see an empty grid.
  const trimTrailing  = hasMore && gridCols > 0 && allDisplayItems.length > gridCols
    ? allDisplayItems.length % gridCols
    : 0;
  const displayItems  = trimTrailing > 0 ? allDisplayItems.slice(0, -trimTrailing) : allDisplayItems;

  return (
    <div>
      <IncomingBackLink />
      <div className="flex flex-col gap-3 mb-8">
        {/* Toolbar is always two rows: tab strip on top (filter the corpus),
            controls cluster below (how to view it). Single-row layout used
            to clip the search bar at borderline widths once Archived joined
            the tab strip in 1.20.0. */}
        <div className="flex flex-col gap-3">
          {/* On phones the full tab strip sums to well past the ~390 px
              iPhone viewport, so the strip scrolls horizontally inside
              its own min-w-0 wrapper (overflow containment also keeps
              the page from expanding and breaking `fixed right-0`
              overlays — the original 1.20.x bug). Below sm the three
              archival tabs fold into the More menu and the trigger is
              pinned OUTSIDE the scroll wrapper, so it stays visible at
              the right edge no matter how far the strip scrolls —
              inside the strip it would live off-screen, exactly the
              discoverability hole it exists to fix. */}
          <div className="flex items-center gap-1.5 -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="overflow-x-auto min-w-0">
            <div role="tablist" aria-label="Library view" className="flex gap-1 bg-neutral-900 p-1 rounded-lg w-fit">
              {TABS.map((t, i) => (
                <button
                  key={t.key}
                  ref={el => { tabRefs.current[i] = el; }}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  tabIndex={tab === t.key ? 0 : -1}
                  onClick={() => switchTab(t.key)}
                  onKeyDown={e => handleTabKey(e, i)}
                  className={`h-9 items-center px-5 text-sm rounded-md whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                    MORE_TAB_KEYS.has(t.key) ? 'hidden sm:inline-flex' : 'inline-flex'
                  } ${
                    tab === t.key
                      ? 'bg-binding/25 text-parchment font-semibold'
                      : 'font-medium text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {t.label}{counts[t.key] != null ? <span className="ml-1.5 text-xs opacity-50 tabular-nums">{counts[t.key]}</span> : null}
                </button>
              ))}
            </div>
            </div>
            {/* Mobile-only trigger for the folded tabs, in its own pill
                so it reads as part of the strip. When the active tab is
                a folded one, the trigger wears its label and the active
                style so the selection is never invisible — the real
                (display:none) tab button still carries aria-selected. */}
            <div className="sm:hidden flex-none bg-neutral-900 p-1 rounded-lg">
              <button
                ref={moreBtnRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={toggleMoreMenu}
                className={`h-9 inline-flex items-center px-4 text-sm rounded-md whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                  MORE_TAB_KEYS.has(tab)
                    ? 'bg-binding/25 text-parchment font-semibold'
                    : 'font-medium text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {MORE_TAB_KEYS.has(tab) ? TABS.find(t => t.key === tab)?.label : 'More'}
                <span aria-hidden="true" className="ml-1 text-xs opacity-60">▾</span>
              </button>
            </div>
            {countsError && (
              // Counts fetch failed — badge numbers are missing. A small ⚠
              // glyph next to the tab strip explains why on hover without
              // shifting layout for the common case where counts succeeded.
              <span title="Failed to load tab counts" aria-label="Failed to load tab counts"
                    className="text-warn/70 text-xs leading-none cursor-help select-none">⚠</span>
            )}
            {moreOpen && morePos && createPortal(
              <div
                ref={moreMenuRef}
                role="menu"
                aria-label="More library views"
                className="z-50 min-w-40 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1"
                style={{ position: 'fixed', top: morePos.top, left: morePos.left }}
              >
                {MORE_TABS.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitem"
                    onClick={() => { switchTab(t.key); setMoreOpen(false); }}
                    className={`w-full flex items-center justify-between gap-4 px-4 py-2 text-sm text-left transition-colors ${
                      tab === t.key
                        ? 'text-parchment font-semibold bg-binding/25'
                        : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    {t.label}
                    {counts[t.key] != null && <span className="text-xs opacity-50 tabular-nums">{counts[t.key]}</span>}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); setExpandedSeries(new Set()); }}
              className={`h-9 bg-neutral-800 border rounded-lg px-3 text-sm focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150 disabled:opacity-60 ${sort === 'updated' ? 'border-neutral-700 text-neutral-300' : 'border-oak/50 text-parchment'}`}
            >
              {/* Duration is gated on format-filter via requiresAudiobook
                  (visible when no format filter is set, since all formats
                  show, or when 'audiobook' is in the selected set). */}
              {SORTS.filter(s => {
                if (s.tabs && !s.tabs.includes(tab)) return false;
                if (s.requiresAudiobook) {
                  const fmts = filters.formats ?? [];
                  if (fmts.length > 0 && !fmts.includes('audiobook')) return false;
                }
                return true;
              }).map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            {sort === 'random' && (
              <button
                type="button"
                onClick={() => setRandomSeed(rollSeed())}
                title="Reshuffle"
                aria-label="Reshuffle random order"
                className="h-9 inline-flex items-center justify-center text-neutral-500 hover:text-parchment text-base leading-none px-2 rounded-lg border border-neutral-800 hover:border-oak/50 transition-colors duration-150"
              >
                🎲
              </button>
            )}
            {/* Search input + ?-help are desktop-only. On a phone the
                input was getting shrunk to ~40 px under flex pressure
                from the other toolbar items, leaving only the ?-help
                icon visible and the field unusable. The keyboard-only
                search-syntax help is also irrelevant on touch. Mobile
                users can search via the global command palette. */}
            <div className="relative w-80 hidden sm:block">
              <input
                ref={searchRef}
                type="search"
                value={queryRaw}
                aria-label="Search library"
                onChange={(e) => setQueryRaw(e.target.value)}
                onKeyDown={(e) => {
                  // Enter flushes the 300ms debounce — keyboard users get
                  // the snappy feedback they expect from a "submit" key.
                  // Writes directly to the URL with replace:true, same as
                  // the debounce target, so search-as-you-type and the
                  // Enter shortcut converge on identical state.
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setSearchParams(prev => {
                      const next = new URLSearchParams(prev);
                      if (queryRaw) next.set('q', queryRaw); else next.delete('q');
                      return next;
                    }, { replace: true, state: navState });
                  }
                }}
                placeholder="Search title, people, series, or tags…"
                className="h-9 w-full bg-neutral-800 border border-leather/30 rounded-lg pl-4 pr-10 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-leather/70 focus:ring-1 focus:ring-oak/25 transition-colors duration-150 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {/* z-20 lifts this wrapper above the book grid below — the
                  -translate-y-1/2 transform here creates a stacking context
                  that traps SearchHelp's own popover z-index, so a higher
                  z-index has to live on the outer wrapper for the popover
                  to clear the grid. */}
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20">
                <SearchHelp />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen(o => !o)}
              className={`h-9 inline-flex items-center gap-1.5 text-sm px-3 rounded-lg whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                filtersOpen || activeCount > 0
                  ? 'bg-binding/25 text-parchment'
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FilterIcon />
              Filters
              {activeCount > 0 && (
                <span className="bg-oak text-neutral-950 text-xs font-bold w-4 h-4 flex items-center justify-center rounded-full leading-none ml-0.5">
                  {activeCount}
                </span>
              )}
            </button>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors whitespace-nowrap"
              >
                Clear all
              </button>
            )}
            {/* Redundant on mobile — the active tab already shows the
                count next to its label. */}
            <span className="hidden sm:inline text-xs text-neutral-600 tabular-nums whitespace-nowrap">
              {plural(total, 'book')}
            </span>
            {/* Desktop: cover-size slider inline. Mobile: a single
                "View" button opens a sheet with the slider — keeps
                the toolbar fittable on a phone viewport. */}
            <div className="hidden sm:block">
              <CoverSizeSlider size={coverSize} onChange={setCoverSize} min={coverMin} max={coverMax} />
            </div>
            <button
              type="button"
              onClick={() => setViewOptionsOpen(true)}
              aria-label="View options"
              className="sm:hidden h-9 inline-flex items-center gap-1.5 text-sm px-3 rounded-lg whitespace-nowrap bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <SlidersIcon />
              View
            </button>
          </div>
        </div>

        {filtersOpen && facets && (
          <FilterPanel tab={tab} facets={facets} filters={filters} onChange={setFilters} />
        )}
        {filtersOpen && !facets && facetsError && (
          // Facets fetch failed and we have nothing to show. The filter panel
          // would otherwise be invisible (gated on facets being non-null);
          // surface why so the user knows it's a fetch error, not "you have
          // no facets to filter on".
          <p role="alert" className="text-xs text-warn mt-3 pt-4 border-t border-neutral-800/60">
            Failed to load filter options.
          </p>
        )}
      </div>

      {/* Mobile View-options sheet. Centred modal containing the
          cover-size slider. The slider lives inline on desktop; on
          mobile the inline copy is hidden and the only way to adjust
          cover size is here. Keep this list minimal — additions
          should be "set-and-forget" only, not per-glance toggles
          like Sort/Filters. */}
      {viewOptionsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="View options"
          className="sm:hidden fixed inset-0 z-50 flex items-end justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setViewOptionsOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/70 pointer-events-none" />
          <div className="relative w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-parchment">View options</p>
              <button
                type="button"
                onClick={() => setViewOptionsOpen(false)}
                aria-label="Close"
                className="text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none px-1"
              >
                ×
              </button>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-neutral-300">Cover size</span>
              <CoverSizeSlider size={coverSize} onChange={setCoverSize} min={coverMin} max={coverMax} />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <GridSkeleton
          count={20}
          compact={compact}
          gridStyle={gridStyle}
          gridClassName={gridClassName}
        />
      ) : fetchError ? (
        <div className="text-center py-32">
          <p className="text-neutral-600">Failed to load books. Please try again.</p>
        </div>
      ) : books.length === 0 ? (
        <div className="text-center py-32">
          {queryRaw || activeCount > 0 ? (
            <p className="text-neutral-600">No books match the current filters.</p>
          ) : (
            <>
              <p className="text-neutral-600 mb-3">No books in this library yet.</p>
              <Link
                to="/books/new"
                state={{ from: 'Library', fromPath: '/' + locationSearch }}
                className="text-sm text-oak hover:text-leather"
              >Add your first book →</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className={gridClassName} style={gridStyle}>
            {displayItems.map(item =>
              item.type === 'series' ? (
                <SeriesCard
                  key={item.name}
                  seriesName={item.name}
                  books={item.books}
                  seriesTotal={seriesTotals.get(item.name)}
                  expanded={expandedSeries.has(item.name)}
                  onToggle={() => toggleSeries(item.name)}
                  compact={compact}
                />
              ) : (
                <BookCard
                  key={item.book.id}
                  book={item.book}
                  onProgressUpdate={handleProgressUpdate}
                  compact={compact}
                  linkState={fromState}
                />
              )
            )}
          </div>
          {hasMore && (
            <div className="mt-10 flex justify-center gap-3">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore || loadingAll}
                className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-60 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
              >
                {loadingMore ? 'Loading…' : `Load more · ${total - loadedCount} remaining`}
              </button>
              <button
                type="button"
                onClick={loadAll}
                disabled={loadingMore || loadingAll}
                className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-60 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
              >
                {loadingAll ? `Loading all · ${loadedCount}/${total}` : 'Load all'}
              </button>
            </div>
          )}
          {actionError && (
            <p role="alert" className="mt-3 text-center text-xs text-warn">
              {typeof actionError === 'string' ? actionError : 'Failed to load more books.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
