import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import BookCard from '../components/BookCard.jsx';
import FilterPanel from '../components/FilterPanel.jsx';
import SearchHelp from '../components/SearchHelp.jsx';
import SeriesCard from '../components/library/SeriesCard.jsx';
import { EMPTY_FILTERS, countFilters, pruneFilters, buildApiParams } from '../components/library/filters.js';
import { paramsToFilters, writeFiltersToParams, filtersEqual } from '../components/library/urlState.js';
import { buildDisplayItems, sortVolumes } from '../components/library/grouping.js';
import { useGridCols, COMFORTABLE_BPS, COMPACT_BPS } from '../hooks/useGridCols.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

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
// view": per-tab sort memory, grid density, filter-panel open state.
// View state (tab/sort/query/filters) lives in the URL — see urlState.js.
const PREFS_KEY = 'spine-library-prefs';

const SORTS = [
  { key: 'updated',     label: 'Recently updated' },
  { key: 'last_logged', label: 'Recently logged' },
  { key: 'added',       label: 'Recently added' },
  { key: 'author',      label: 'Author A–Z' },
  { key: 'title',       label: 'Title A–Z' },
  { key: 'rating',      label: 'Rating' },
  { key: 'progress',    label: 'Progress' },
  { key: 'started',     label: 'Date started' },
  { key: 'finished',    label: 'Date finished' },
  { key: 'length',      label: 'Length' },
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

const GRID = {
  comfortable: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start',
  compact:     'grid grid-cols-6 sm:grid-cols-9 md:grid-cols-12 gap-0.5 items-start',
};

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
function SortableBookCard({ book, compact }) {
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
      <BookCard book={book} coverOverlay={overlay} compact={compact} hideActions />
    </div>
  );
}

const VALID_TABS = new Set(['reading', 'finished', 'unread', 'owned', 'prev_owned', 'never_owned', 'all', 'archived']);

export default function Library() {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [density,     setDensity]     = useState(() => prefs.density === 'compact' ? 'compact' : 'comfortable');
  const [filtersOpen, setFiltersOpen] = useState(() => typeof prefs.filtersOpen === 'boolean' ? prefs.filtersOpen : false);

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
    });
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
    setSearchParams(next);
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
    });
    // Re-roll on switch INTO random so the user sees a fresh shuffle
    // (otherwise the same seed would carry forward from a prior random
    // tab, which feels stale).
    if (resolved === 'random' && sort !== 'random') setRandomSeed(rollSeed());
  }
  // Search-box value is kept in local state so each keystroke is
  // responsive; a 300ms debounce flushes the value to the URL. URL
  // writes use replace:true so typing doesn't spam the history stack.
  const [queryRaw, setQueryRaw] = useState(query);

  const [books,       setBooks]       = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll,  setLoadingAll]  = useState(false);
  const [fetchError,  setFetchError]  = useState(false);
  // Distinct from fetchError (which fully replaces the list when the
  // initial fetch fails). Pagination failures are transient and should
  // leave the loaded books visible; surfaced near the Load more buttons.
  const [actionError, setActionError] = useState(null);
  const [facets,      setFacets]      = useState(null);
  const [facetsError, setFacetsError] = useState(false);
  const [counts,      setCounts]      = useState({});
  const [countsError, setCountsError] = useState(false);
  const [expandedSeries, setExpandedSeries] = useState(new Set());
  // Edit mode toggles drag handles on cards for the Custom-order rank on the
  // Never owned tab. Mirrors ListDetail.editMode. Only meaningful when
  // tab='never_owned' && sort='custom' — entering edit mode coerces both.
  const [editMode, setEditMode] = useState(false);

  const loadedRef  = useRef(0);
  const genRef     = useRef(0);
  const prevTabRef = useRef(null);
  const searchRef  = useRef(null);
  // Bumped on every drag so a failed PUT whose .catch lands after a later
  // drag's optimistic apply doesn't restore a stale snapshot. Same shape as
  // ListDetail.reorderSeqRef.
  const reorderSeqRef = useRef(0);
  // Synchronous mirror of the loadingMore/loadingAll *pair*. The button
  // disabled props gate user clicks but `setLoadingMore`/`setLoadingAll`
  // (state) don't commit until the next render — so two same-tick clicks
  // (or one click each on Load more + Load all) both pass the
  // `loadingMore || loadingAll` check, both fire getBooks at the same
  // offset, both append the same books, and loadedRef.current ends up
  // double-bumped (next page request lands at the wrong offset). Shared
  // between handlers so cross-handler races are caught too.
  const pagingRef = useRef(false);
  // Snapshot of the books-fetch deps (excluding refreshTick) so we can
  // distinguish a real state change (tab/sort/filters/query/randomSeed
  // moved) from a refresh-tick refetch at the same state. On a same-
  // state refetch we skip the visible-state reset so the user's scroll
  // position survives the alt-tab roundtrip — same shape as the
  // ShelfView horizontal-scroll fix.
  const lastFetchKeyRef = useRef('');
  // Refs mirroring the latest tab + sort. handleProgressUpdate is invoked
  // asynchronously by BookCard after its PUT resolves; if the user
  // switched tabs mid-flight, the function's closure-captured tab would
  // be stale and could remove a book from the NEW tab's freshly-fetched
  // list. Reading from refs ensures the latest values are used regardless
  // of which render's function instance gets invoked.
  const tabRef  = useRef(tab);
  const sortRef = useRef(sort);
  tabRef.current  = tab;
  sortRef.current = sort;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Refetch counter — bumps when the tab regains focus so newly-added
  // books from another window/process appear without a manual reload.
  const refreshTick = useRefreshTick();

  // Bridge for the command palette's Load more / Load all entries: handler
  // refs let the global event listeners call the *latest* closures without
  // re-attaching on every render, and a state ref keeps the response to
  // 'paging-request' events from going stale.
  const loadHandlersRef = useRef({ loadMore: null, loadAll: null });
  const pagingStateRef  = useRef({ hasMore: false, loadingMore: false, loadingAll: false, loaded: 0, total: 0 });

  // Local-remove-on-delete: BookCard's MoreMenu (and the command
  // palette's book.delete action) dispatch spine:book-deleted after a
  // successful api.deleteBook. Filtering in place is much cheaper than
  // refetching the whole page, and keeps the user's scroll position.
  useEffect(() => {
    function onDeleted(e) {
      const id = Number(e.detail?.id);
      if (!id) return;
      setBooks(prev => prev.filter(b => b.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
      loadedRef.current = Math.max(0, loadedRef.current - 1);
    }
    window.addEventListener('spine:book-deleted', onDeleted);
    return () => window.removeEventListener('spine:book-deleted', onDeleted);
  }, []);

  // Refetch-and-replace on mutation: BookCard's MoreMenu (and the
  // command palette's status toggles, list adds, etc.) dispatch
  // spine:book-mutated after a successful PATCH or PUT. We refetch the
  // single book and swap it into the books array so the card re-renders
  // with its new state in place. Note: if the new state no longer fits
  // the current tab/filter (e.g. user marked reading→finished while on
  // Reading tab), the book stays visible until the next full refetch
  // — minor inconsistency we accept in exchange for not nuking scroll
  // position on every mutation.
  useEffect(() => {
    function onMutated(e) {
      const id = Number(e.detail?.id);
      if (!id) return;
      api.getBook(id)
        .then(updated => {
          setBooks(prev => prev.map(b => b.id === id ? updated : b));
        })
        .catch(() => {});
    }
    window.addEventListener('spine:book-mutated', onMutated);
    return () => window.removeEventListener('spine:book-mutated', onMutated);
  }, []);

  // Bridge to the command palette: respond to a paging-state request and
  // listen for invocations of Load more / Load all. Calls go through refs
  // so the listeners always see the latest handlers + state without
  // re-attaching every render.
  useEffect(() => {
    function onRequest() {
      window.dispatchEvent(new CustomEvent('spine:library-paging', { detail: pagingStateRef.current }));
    }
    function onLoadMore() { loadHandlersRef.current.loadMore?.(); }
    function onLoadAll()  { loadHandlersRef.current.loadAll?.(); }
    window.addEventListener('spine:library-paging-request', onRequest);
    window.addEventListener('spine:library-load-more',      onLoadMore);
    window.addEventListener('spine:library-load-all',       onLoadAll);
    return () => {
      window.removeEventListener('spine:library-paging-request', onRequest);
      window.removeEventListener('spine:library-load-more',      onLoadMore);
      window.removeEventListener('spine:library-load-all',       onLoadAll);
    };
  }, []);

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
      }, { replace: true });
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

  // Persist UI preferences (sort memory, density, filter-panel state)
  // to localStorage so they survive across tabs and sessions. View
  // state (tab/sort/query/filters) lives in the URL, not here.
  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sortByTab, density, filtersOpen }));
  }, [sortByTab, density, filtersOpen]);

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

  // Fetch books on tab / sort / filter / query change — always reset to page 1
  useEffect(() => {
    let stale = false;
    genRef.current += 1;
    setFetchError(false);
    // Distinguish a real state change from a refresh-tick refetch.
    // On real changes (tab/sort/filters/query/randomSeed moved), wipe
    // visible state so the old list doesn't show on the new view. On
    // same-state refreshTick refetches, keep books visible so scroll
    // position survives — without this the briefly-empty grid lets the
    // browser clamp scroll to 0 and the user pops back to row 1 after
    // alt-tabbing into a deep list.
    const fetchKey = `${tab}|${sort}|${JSON.stringify(filters)}|${query}|${randomSeed}`;
    const isSameState = fetchKey === lastFetchKeyRef.current;
    lastFetchKeyRef.current = fetchKey;
    if (!isSameState) {
      setLoading(true);
      setBooks([]);
    }
    // Reset pagination flags + action banner: a refresh-tick / sort / tab
    // / filter / query change that fires while loadMore/loadAll is in
    // flight would otherwise strand the flags at true (their finally
    // clauses are gated on gen match) and leave the previous failure
    // banner sitting above the freshly-loaded list.
    // Also reset pagingRef so the new tab's Load more isn't blocked
    // while the abandoned old fetch is still in flight.
    setLoadingMore(false);
    setLoadingAll(false);
    setActionError(null);
    pagingRef.current = false;
    loadedRef.current = 0;
    api.getBooks(buildApiParams(tab, sort, filters, query, 0, randomSeed)).then(({ books: b, total: t }) => {
      if (stale) return;
      setBooks(b);
      setTotal(t);
      loadedRef.current = b.length;
    }).catch(() => { if (!stale) setFetchError(true); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [tab, sort, filters, query, refreshTick, randomSeed]);

  function handleLoadMore() {
    // Mirror the disabled button. React batches state updates, so two
    // rapid clicks before the next render both see loadingMore=false and
    // would otherwise fire duplicate requests at the same offset, then
    // each appends the same books and bumps loadedRef twice. pagingRef
    // (synchronous) closes that gap and also catches the cross-handler
    // race (Load more + Load all in the same tick).
    if (pagingRef.current || loadingMore || loadingAll) return;
    const gen = genRef.current;
    pagingRef.current = true;
    setLoadingMore(true);
    setActionError(null);
    api.getBooks(buildApiParams(tab, sort, filters, query, loadedRef.current, randomSeed)).then(({ books: b, total: t }) => {
      if (gen !== genRef.current) return;
      setBooks(prev => [...prev, ...b]);
      setTotal(t);
      loadedRef.current += b.length;
    }).catch(() => {
      if (gen === genRef.current) setActionError('Failed to load more books.');
    }).finally(() => {
      // Clear the ref unconditionally — if the gen has bumped, the new
      // load effect already reset loadingMore via setState, so leaving
      // the ref stuck would block all future paging on the new tab.
      pagingRef.current = false;
      if (gen === genRef.current) setLoadingMore(false);
    });
  }

  async function handleLoadAll() {
    if (pagingRef.current || loadingMore || loadingAll) return;
    const gen = genRef.current;
    pagingRef.current = true;
    setLoadingAll(true);
    setActionError(null);
    try {
      let serverTotal = total;
      while (gen === genRef.current && loadedRef.current < serverTotal) {
        const { books: b, total: t } = await api.getBooks(buildApiParams(tab, sort, filters, query, loadedRef.current, randomSeed));
        if (gen !== genRef.current) break;
        setBooks(prev => [...prev, ...b]);
        setTotal(t);
        loadedRef.current += b.length;
        serverTotal = t;
        if (b.length === 0) break; // guard against unexpected 0-length response
      }
    } catch {
      if (gen === genRef.current) setActionError('Failed to load more books.');
    } finally {
      pagingRef.current = false;
      if (gen === genRef.current) setLoadingAll(false);
    }
  }

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
      loadedRef.current = Math.max(0, loadedRef.current - 1);
      setTotal(t => Math.max(0, t - 1));
      setBooks(bs => bs.filter(b => b.id !== updated.id));
    } else if (currentSort === 'updated') {
      // Mirror the server's `updated_at DESC` ordering locally so an inline
      // edit (rating, progress, finish) bumps the book to the top right away
      // instead of waiting for a refetch on next mount.
      setBooks(bs => [updated, ...bs.filter(b => b.id !== updated.id)]);
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
    // matches the order being persisted.
    if (!editMode) {
      if (tab !== 'never_owned') setTab('never_owned');
      if (sort !== 'custom')     setSort('custom');
    }
    setEditMode(m => !m);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Guard against drag-then-PUT against a paginated subset. The Edit
    // button is disabled until all are loaded, but a refresh-tick or a
    // filter change while editing can reset `books` to a fresh first
    // page; without this check the resulting PUT would stamp ranks on
    // those 48 only and leave stale ranks on the rest. Same root cause
    // the button gate addresses, second line of defence.
    if (loadedRef.current < total) {
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
    const gen = genRef.current;
    const reorderSeq = ++reorderSeqRef.current;
    api.setDesireOrder(reordered.map(b => b.id)).catch(() => {
      if (gen !== genRef.current || reorderSeq !== reorderSeqRef.current) return;
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
  const fromState = useMemo(() => {
    const qs = searchParams.toString();
    return { from: 'Library', fromPath: qs ? `/?${qs}` : '/' };
  }, [searchParams]);
  const gridCols        = useGridCols(density === 'compact' ? COMPACT_BPS : COMFORTABLE_BPS);
  const hasMore         = loadedRef.current < total;

  // Bridge: keep refs in sync with the latest handlers and paging state so
  // the global listeners attached above invoke the current closures, and
  // publish state changes for the command palette to mirror.
  loadHandlersRef.current = { loadMore: handleLoadMore, loadAll: handleLoadAll };
  pagingStateRef.current  = { hasMore, loadingMore, loadingAll, loaded: loadedRef.current, total };
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('spine:library-paging', { detail: pagingStateRef.current }));
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
      <div className="flex flex-col gap-3 mb-8">
        {/* Toolbar is always two rows: tab strip on top (filter the corpus),
            controls cluster below (how to view it). Single-row layout used
            to clip the search bar at borderline widths once Archived joined
            the tab strip in 1.20.0. */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1 bg-neutral-900 p-1 rounded-lg w-fit">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                    setExpandedSeries(new Set());
                    // Edit mode is scoped to the Never owned tab — clear it
                    // on tab switch so the drag handles don't bleed onto
                    // tabs where reordering isn't a thing. Per-tab sort
                    // memory means we no longer need to coerce a 'custom'
                    // sort here: each tab carries its own sort, so 'custom'
                    // only ever lives in the never_owned slot.
                    if (t.key !== 'never_owned') setEditMode(false);
                  }}
                  className={`px-5 py-2 text-sm rounded-md whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
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
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 transition-colors duration-150 disabled:opacity-50"
            >
              {/* Filter sort options to those allowed on the active tab. The
                  Custom-order sort is gated to Never owned via SORTS[].tabs. */}
              {SORTS.filter(s => !s.tabs || s.tabs.includes(tab)).map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            {sort === 'random' && (
              <button
                type="button"
                onClick={() => setRandomSeed(rollSeed())}
                title="Reshuffle"
                aria-label="Reshuffle random order"
                className="text-neutral-500 hover:text-parchment text-base leading-none px-2 py-2 rounded-lg border border-neutral-800 hover:border-oak/50 transition-colors duration-150"
              >
                🎲
              </button>
            )}
            {tab === 'never_owned' && (
              <button
                onClick={toggleEditMode}
                // Edit is gated on the full corpus being loaded. The PUT
                // /books/desire-order route stamps `desire_rank = i` on
                // exactly the ids it receives and leaves all other rows
                // untouched, so a reorder against a paginated subset (the
                // 48-book first page) leaves stale ranks on un-loaded
                // books to collide with the freshly-stamped 0..47 — books
                // the user just dragged to the top can be silently
                // outranked by a higher-id book holding an old rank.
                // Forcing Load all first keeps every rank in one
                // consistent batch.
                disabled={!editMode && loadedRef.current < total}
                title={!editMode && loadedRef.current < total ? 'Load all books first to rank' : ''}
                className={`text-sm px-3 py-2 rounded-lg whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  editMode
                    ? 'bg-binding/25 text-parchment'
                    : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {editMode ? 'Done' : 'Edit'}
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
                    }, { replace: true });
                  }
                }}
                placeholder="Search title, people, series, or tags…"
                className="w-full bg-neutral-800 border border-leather/30 rounded-lg pl-4 pr-10 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-leather/70 focus:ring-1 focus:ring-oak/25 transition-colors duration-150 [&::-webkit-search-cancel-button]:appearance-none"
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
              onClick={() => setFiltersOpen(o => !o)}
              className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
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
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors whitespace-nowrap"
              >
                Clear all
              </button>
            )}
            <span className="text-xs text-neutral-600 tabular-nums whitespace-nowrap">
              {total} {total === 1 ? 'book' : 'books'}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setDensity('comfortable')} title="Comfortable grid" aria-label="Comfortable grid" aria-pressed={density === 'comfortable'} className={`transition-colors ${density === 'comfortable' ? 'text-neutral-300' : 'text-neutral-700 hover:text-neutral-400'}`}>
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                  <rect x="1" y="1" width="4" height="4" rx="0.5"/><rect x="6" y="1" width="4" height="4" rx="0.5"/><rect x="11" y="1" width="4" height="4" rx="0.5"/>
                  <rect x="1" y="6" width="4" height="4" rx="0.5"/><rect x="6" y="6" width="4" height="4" rx="0.5"/><rect x="11" y="6" width="4" height="4" rx="0.5"/>
                  <rect x="1" y="11" width="4" height="4" rx="0.5"/><rect x="6" y="11" width="4" height="4" rx="0.5"/><rect x="11" y="11" width="4" height="4" rx="0.5"/>
                </svg>
              </button>
              <button onClick={() => setDensity('compact')} title="Compact grid" aria-label="Compact grid" aria-pressed={density === 'compact'} className={`transition-colors ${density === 'compact' ? 'text-neutral-300' : 'text-neutral-700 hover:text-neutral-400'}`}>
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                  <rect x="1" y="1" width="6.5" height="6.5" rx="0.5"/><rect x="8.5" y="1" width="6.5" height="6.5" rx="0.5"/>
                  <rect x="1" y="8.5" width="6.5" height="6.5" rx="0.5"/><rect x="8.5" y="8.5" width="6.5" height="6.5" rx="0.5"/>
                </svg>
              </button>
            </div>
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

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
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
              <p className="text-neutral-600 mb-3">Nothing here yet.</p>
              <Link to="/books/new" className="text-sm text-oak hover:text-leather">Add your first book →</Link>
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
                <div className={GRID[density]}>
                  {books.map(book => (
                    <SortableBookCard key={book.id} book={book} compact={density === 'compact'} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className={GRID[density]}>
              {displayItems.map(item =>
                item.type === 'series' ? (
                  <SeriesCard
                    key={item.name}
                    seriesName={item.name}
                    books={item.books}
                    expanded={expandedSeries.has(item.name)}
                    onToggle={() => toggleSeries(item.name)}
                    compact={density === 'compact'}
                  />
                ) : (
                  <BookCard
                    key={item.book.id}
                    book={item.book}
                    onProgressUpdate={handleProgressUpdate}
                    compact={density === 'compact'}
                    linkState={fromState}
                  />
                )
              )}
            </div>
          )}
          {hasMore && (
            <div className="mt-10 flex flex-col items-center gap-2">
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore || loadingAll}
                  className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingMore ? 'Loading…' : `Load more · ${total - loadedRef.current} remaining`}
                </button>
                <button
                  onClick={handleLoadAll}
                  disabled={loadingMore || loadingAll}
                  className="text-sm text-neutral-500 hover:text-neutral-200 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingAll ? `Loading all · ${loadedRef.current}/${total}` : 'Load all'}
                </button>
              </div>
              {actionError && <p role="alert" className="text-xs text-warn">{actionError}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
