import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { usePaginatedFetch } from '../hooks/usePaginatedFetch.js';
import { useLatest } from '../hooks/useLatest.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useSpineEvent, dispatchSpineEvent } from '../hooks/useSpineEvent.js';

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
  // Custom (manual rank) sort is gated to the Never owned tab — that's the
  // only surface where it's meaningful. The dropdown filters this entry
  // out on every other tab, but a stale saved sort lands on a non-custom
  // default in the load effect.
  { key: 'custom',      label: 'Custom order', tabs: ['never_owned'] },
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

function DragHandle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
    </svg>
  );
}

// Edit-mode wrapper around BookCard — adds drag-to-reorder without touching
// BookCard. Whole-cover drag: dnd-kit listeners attach to the wrapper so
// the user can grab anywhere on the cover; the centered three-lines glyph
// is purely decorative (pointer-events:none) and only appears on hover as
// a "this is grabbable" cue. Cover navigation is already suppressed by
// hideActions, so there's no competing click semantic to preserve.
function SortableBookCard({ book, compact, linkState }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const overlay = (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
      <div className="bg-black/75 backdrop-blur-sm rounded px-2 py-1 text-neutral-300">
        <DragHandle />
      </div>
    </div>
  );
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative select-none transition-opacity ring-2 ring-binding/40 rounded-lg cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <BookCard book={book} coverOverlay={overlay} compact={compact} hideActions linkState={linkState} />
    </div>
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
  // Random-sort seed lives only in component state — refresh re-rolls,
  // which matches the user's mental model of "each session is a fresh
  // shuffle". The die button explicitly re-rolls without reload.
  const [randomSeed, setRandomSeed] = useState(rollSeed);
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

  // Cohort fetch is independent of the paginated visible-books fetch so
  // BookDetail's prev/next can walk the current filter+sort view past the
  // first 48 books. Server caps at 200; libraries / filtered views larger
  // than that truncate the cohort there. Refreshes on the same triggers
  // as the main load (tab/sort/filters/query/randomSeed/refreshTick).
  const [cohort, setCohort] = useState([]);
  // Paginated visible-books fetch — handles tab/sort/filter/query/
  // randomSeed state changes (key drives wipe + skeleton), refresh-tick
  // depth restoration (Load-all'd views come back at the same depth on
  // alt-tab), and Load more / Load all.
  //
  // stopWhen lets the initial load keep fetching beyond pageSize when
  // the visible grid would otherwise be too sparse — a bulk-add of
  // N≥PAGE_SIZE books sharing a series collapses into a single
  // SeriesCard, leaving the grid visually empty even though page 1
  // loaded fully. After hitting the natural page floor, keep going
  // until at least one full grid row of display items would render.
  // Custom sort bypasses grouping so the density check returns true
  // immediately (first page is always enough).
  const {
    items: books, setItems: setBooks,
    total, setTotal,
    loading, loadingMore, loadingAll,
    hasMore, loadedCount, setLoadedCount,
    error: fetchError,
    actionError, setActionError,
    loadMore, loadAll,
  } = usePaginatedFetch(
    (offset, limit) => api.getBooks(buildApiParams(tab, sort, filters, query, offset, randomSeed, limit))
      .then(r => ({ items: r.books, total: r.total })),
    [tab, sort, filters, query, randomSeed],
    {
      key: `${tab}|${sort}|${JSON.stringify(filters)}|${query}|${randomSeed}`,
      pageSize: PAGE_SIZE,
      stopWhen: (collected) => {
        if (sort === 'custom') return true;
        const visible = buildDisplayItems(collected, expandedSeries).length;
        return visible >= Math.max(coverCols, 1);
      },
    },
  );
  const [facets,      setFacets]      = useState(null);
  const [facetsError, setFacetsError] = useState(false);
  const [counts,      setCounts]      = useState({});
  const [countsError, setCountsError] = useState(false);
  const [expandedSeries, setExpandedSeries] = useState(new Set());
  // Library-wide series totals, keyed by series name → book_count. Fetched
  // once on mount from /api/series so the SeriesCard badge can render
  // "13/25" when the current view has only loaded part of a series instead
  // of misleadingly showing just "13" as if that were the series' size.
  // Failure is silent — the badge falls back to the loaded count.
  const [seriesTotals, setSeriesTotals] = useState(new Map());
  useEffect(() => {
    api.getSeries().then(rows => {
      setSeriesTotals(new Map(rows.map(r => [r.name, r.book_count])));
    }).catch(() => {});
  }, []);
  // Edit mode toggles drag handles on cards for the Custom-order rank on the
  // Never owned tab. Mirrors ListDetail.editMode. Only meaningful when
  // tab='never_owned' && sort='custom' — entering edit mode coerces both.
  const [editMode, setEditMode] = useState(false);
  // 2-step intent for entering edit mode: a click on Edit first switches
  // sort to Custom and triggers Load all if needed. Once both are
  // settled, the useEffect below promotes the intent to actual editMode.
  // The intermediate state lets the button reflect "Loading…" so the
  // user knows the click took effect even when there's a pause.
  const [enteringEdit, setEnteringEdit] = useState(false);

  // useStaleGuard kept solely for handleDragEnd's reorder-seq capture
  // (a failed PUT whose recovery lands after a later drag needs the same
  // navigation-guard semantics). The hook handles its own internal guard
  // for paging.
  const guard      = useStaleGuard();
  const prevTabRef = useRef(null);
  const searchRef  = useRef(null);
  // Bumped on every drag so a failed PUT whose .catch lands after a later
  // drag's optimistic apply doesn't restore a stale snapshot. Same shape as
  // ListDetail.reorderSeqRef.
  const reorderSeqRef = useRef(0);
  const tabRefs = useRef([]);

  function switchTab(key) {
    setTab(key);
    setExpandedSeries(new Set());
    // Edit mode is scoped to the Never owned tab — clear it on tab
    // switch so drag handles don't bleed onto tabs where reordering
    // isn't a thing.
    if (key !== 'never_owned') setEditMode(false);
  }

  function handleTabKey(e, idx) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = (idx + dir + TABS.length) % TABS.length;
      switchTab(TABS[next].key);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      switchTab(TABS[0].key);
      tabRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      switchTab(TABS[TABS.length - 1].key);
      tabRefs.current[TABS.length - 1]?.focus();
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Refetch counter — bumps when the tab regains focus so newly-added
  // books from another window/process appear without a manual reload.
  const refreshTick = useRefreshTick();

  // Bridge for the command palette's Load more / Load all entries — the
  // refs themselves are declared further down (where the handler /
  // paging-state values exist), but the listener effect below references
  // them via closure. JS hoists the const bindings and the closures only
  // read .current after commit, by which point useLatest has populated it.

  // Local-remove-on-delete: BookCard's MoreMenu (and the command
  // palette's book.delete action) dispatch spine:book-deleted after a
  // successful api.deleteBook. Filtering in place is much cheaper than
  // refetching the whole page, and keeps the user's scroll position.
  useSpineEvent('spine:book-deleted', (e) => {
    const id = Number(e.detail?.id);
    if (!id) return;
    setBooks(prev => prev.filter(b => b.id !== id));
    setTotal(prev => Math.max(0, prev - 1));
    setLoadedCount(n => Math.max(0, n - 1));
  });

  // Refetch-and-replace on mutation: BookCard's MoreMenu (and the
  // command palette's status toggles, list adds, etc.) dispatch
  // spine:book-mutated after a successful PATCH or PUT. We refetch the
  // single book and swap it into the books array so the card re-renders
  // with its new state in place. Note: if the new state no longer fits
  // the current tab/filter (e.g. user marked reading→finished while on
  // Reading tab), the book stays visible until the next full refetch
  // — minor inconsistency we accept in exchange for not nuking scroll
  // position on every mutation.
  useSpineEvent('spine:book-mutated', (e) => {
    const id = Number(e.detail?.id);
    if (!id) return;
    api.getBook(id)
      .then(updated => {
        setBooks(prev => prev.map(b => b.id === id ? updated : b));
      })
      .catch(() => {});
  });

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

  // Tab counts badge
  useEffect(() => {
    let stale = false;
    setCountsError(false);
    api.getBookCounts()
      .then(c => { if (!stale) setCounts(c); })
      .catch(() => { if (!stale) setCountsError(true); });
    return () => { stale = true; };
  }, [refreshTick]);

  // Fetch facets on tab / filter / query change; prune only on tab change
  useEffect(() => {
    let stale = false;
    const isTabChange = prevTabRef.current !== tab;
    prevTabRef.current = tab;
    setFacetsError(false);
    api.getBookFacets(buildApiParams(tab, sort, filters, query, 0, randomSeed))
      .then(f => {
        if (stale) return;
        setFacets(f);
        if (isTabChange) setFilters(prev => pruneFilters(prev, f));
      })
      .catch(() => { if (!stale) setFacetsError(true); });
    return () => { stale = true; };
  }, [tab, filters, query, refreshTick]);

  // Parallel cohort fetch — see [cohort] declaration above for rationale.
  // Cleared on every fire so a stale slow response can't stamp the new
  // view's cohort.
  useEffect(() => {
    setCohort([]);
    let cancelled = false;
    api.getBooks(buildApiParams(tab, sort, filters, query, 0, randomSeed, 200))
      .then(({ books: b }) => {
        if (cancelled) return;
        setCohort(b.map(x => ({ id: x.id, title: x.title })));
      })
      .catch(() => { /* fall back to the visible-books shape in fromState */ });
    return () => { cancelled = true; };
  }, [tab, sort, filters, query, refreshTick, randomSeed]);

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

  function toggleEditMode() {
    // Edit mode is only meaningful on the Never owned tab in Custom-order
    // sort. Mirrors ListDetail.toggleEditMode: entering edit mode coerces
    // the sort (and tab, here) so the drag-and-drop you're about to do
    // matches the order being persisted. If the library is partially
    // paginated, also kicks off Load all — the desire-order PUT stamps
    // ranks on the ids it receives and leaves the rest untouched, so
    // ranking a subset would let unloaded books carry stale ranks that
    // outrank user-dragged top books. The useEffect below progresses
    // the intent through Load all → editMode = true once everything
    // is in place.
    if (editMode) {
      setEditMode(false);
      return;
    }
    if (enteringEdit) return;
    setActionError(null);
    setEnteringEdit(true);
    if (tab !== 'never_owned') setTab('never_owned');
    if (sort !== 'custom')     setSort('custom');
  }

  // Drives the enteringEdit → editMode transition: waits for tab + sort
  // to settle on (never_owned, custom), triggers Load all if there are
  // unloaded books, then activates editMode once everything is loaded.
  // Bails out (clears the intent) if Load all surfaced an actionError —
  // otherwise the effect would retry loadAll on every state-tick and the
  // button would stay "Loading…" forever after a network blip.
  useEffect(() => {
    if (!enteringEdit) return;
    if (tab !== 'never_owned' || sort !== 'custom') return;
    if (loading || loadingMore || loadingAll) return;
    if (actionError) { setEnteringEdit(false); return; }
    if (hasMore) {
      loadAll();
      return;
    }
    setEditMode(true);
    setEnteringEdit(false);
  }, [enteringEdit, tab, sort, loading, loadingMore, loadingAll, hasMore, actionError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel an in-flight enter-edit intent when the user navigates away
  // from Never owned or away from Custom sort, since the intent only
  // makes sense in that combination.
  useEffect(() => {
    if (enteringEdit && (tab !== 'never_owned' || sort !== 'custom') && !loading) {
      // sort might still be settling immediately after the click; only
      // cancel if both tab and sort have settled to a different combo.
      if (tab !== 'never_owned') setEnteringEdit(false);
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Guard against drag-then-PUT against a paginated subset. The Edit
    // button is disabled until all are loaded, but a refresh-tick or a
    // filter change while editing can reset `books` to a fresh first
    // page; without this check the resulting PUT would stamp ranks on
    // those 48 only and leave stale ranks on the rest. Same root cause
    // the button gate addresses, second line of defence.
    if (hasMore) {
      setActionError('Books reloaded mid-edit — click Done and Load all again before reordering.');
      return;
    }
    const oldIndex = books.findIndex(b => b.id === active.id);
    const newIndex = books.findIndex(b => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previousBooks = books;
    const reordered = arrayMove(previousBooks, oldIndex, newIndex);
    setActionError(null);
    setBooks(reordered);
    const epoch = guard.current();
    const reorderSeq = ++reorderSeqRef.current;
    api.setDesireOrder(reordered.map(b => b.id)).catch(() => {
      if (!guard.isFresh(epoch) || reorderSeq !== reorderSeqRef.current) return;
      setBooks(previousBooks);
      setActionError('Failed to save order.');
    });
  }

  const activeCount   = countFilters(filters);
  // Custom sort is a flat per-volume rank: each book is an independent
  // purchase decision, so series grouping is meaningless and would also
  // make the non-edit and edit-mode views visually asymmetric (edit mode
  // already renders flat). Flatten outside edit mode too.
  const allDisplayItems = sort === 'custom'
    ? books.map(book => ({ type: 'book', book }))
    : buildDisplayItems(books, expandedSeries);
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
          {/* On phones the 6+ tabs (Reading / Finished / Unread / Owned /
              Prev. owned / Never owned …) sum to ~600 px of nowrap flex
              content — wider than the ~390 px iPhone viewport. Without
              the `overflow-x-auto` here the flex children spilled past
              the device width, expanded the page, and mobile browsers
              auto-zoomed out to fit; the side effect was that any
              `fixed right-0` overlay (the hamburger drawer) anchored
              to the widened layout viewport and rendered offscreen. */}
          <div className="flex items-center gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
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
                  className={`h-9 inline-flex items-center px-5 text-sm rounded-md whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                    tab === t.key
                      ? 'bg-binding/25 text-parchment font-semibold'
                      : 'font-medium text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {t.label}{counts[t.key] != null ? <span className="ml-1.5 text-xs opacity-50 tabular-nums">{counts[t.key]}</span> : null}
                </button>
              ))}
            </div>
            {countsError && (
              // Counts fetch failed — badge numbers are missing. A small ⚠
              // glyph next to the tab strip explains why on hover without
              // shifting layout for the common case where counts succeeded.
              <span title="Failed to load tab counts" aria-label="Failed to load tab counts"
                    className="text-warn/70 text-xs leading-none cursor-help select-none">⚠</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={sort}
              // Disabled during edit mode so the sort that the drag order is
              // persisting against can't drift mid-edit. Mirrors ListDetail's
              // editMode-disabled select.
              disabled={editMode}
              title={editMode ? 'Sorting is locked to Custom order while editing' : ''}
              onChange={(e) => { setSort(e.target.value); setExpandedSeries(new Set()); }}
              className={`h-9 bg-neutral-800 border rounded-lg px-3 text-sm focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150 disabled:opacity-60 ${sort === 'updated' ? 'border-neutral-700 text-neutral-300' : 'border-oak/50 text-parchment'}`}
            >
              {/* Filter sort options to those allowed on the active tab. The
                  Custom-order sort is gated to Never owned via SORTS[].tabs;
                  Duration is gated on format-filter via requiresAudiobook
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
            {tab === 'never_owned' && (
              <button
                type="button"
                onClick={toggleEditMode}
                // Always clickable. A click that isn't already in
                // editMode triggers the enteringEdit flow: switch to
                // Custom sort + Load all + then activate edit mode.
                // The PUT /books/desire-order route stamps `desire_rank
                // = i` on exactly the ids it receives, so it MUST run
                // against the full corpus — partial-load ranking
                // leaves un-loaded books with stale ranks that
                // outrank freshly-stamped top picks.
                disabled={enteringEdit}
                title={enteringEdit ? 'Loading all books to rank…' : ''}
                className={`h-9 inline-flex items-center text-sm px-3 rounded-lg whitespace-nowrap transition-colors disabled:opacity-60 disabled:cursor-wait ${
                  editMode
                    ? 'bg-binding/25 text-parchment'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {editMode ? 'Done' : enteringEdit ? 'Loading…' : 'Edit'}
              </button>
            )}
            <div className="relative w-full sm:w-80">
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
            <span className="text-xs text-neutral-600 tabular-nums whitespace-nowrap">
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
          {editMode ? (
            // Drag-to-rank UI for the Never owned tab. Bypasses series
            // grouping (each volume is individually wished/purchased) and
            // the trailing-row trim (a partial last row is fine in edit
            // mode — the user is here to reorder, not to admire the grid).
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={books.map(b => b.id)} strategy={rectSortingStrategy}>
                <div className={gridClassName} style={gridStyle}>
                  {books.map(book => (
                    <SortableBookCard key={book.id} book={book} compact={compact} linkState={fromState} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
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
          )}
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
          {/* actionError lives outside the {hasMore && …} block so the
              handleDragEnd "Failed to save order" message — which can only
              fire in edit mode, where hasMore is false by precondition —
              still surfaces. Load more / Load all failures fire when
              hasMore is true, so the banner appears under the buttons
              in that case. */}
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
