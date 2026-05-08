import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import FilterPanel from '../components/FilterPanel.jsx';
import SearchHelp from '../components/SearchHelp.jsx';
import ListRow from '../components/library/ListRow.jsx';
import SeriesCard from '../components/library/SeriesCard.jsx';
import { EMPTY_FILTERS, countFilters, pruneFilters, buildApiParams } from '../components/library/filters.js';
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

const SESSION_KEY = 'spine-library-state';

const SORTS = [
  { key: 'updated',     label: 'Recently updated' },
  { key: 'last_logged', label: 'Recently logged' },
  { key: 'added',       label: 'Recently added' },
  { key: 'title',       label: 'Title A–Z' },
  { key: 'author',      label: 'Author A–Z' },
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
];

const GRID = {
  comfortable: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start',
  compact:     'grid grid-cols-6 sm:grid-cols-9 md:grid-cols-12 gap-0.5 items-start',
};

function getSaved() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) ?? {}; }
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
// BookCard. Mirrors ListDetail's SortableBookCard: drag listener on the
// handle (not the wrapper) so a click on the cover still routes to detail.
function SortableBookCard({ book, compact }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const overlay = (
    <button
      {...listeners}
      onClick={(e) => e.preventDefault()}
      className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/75 backdrop-blur-sm rounded px-2 py-1 text-neutral-300 hover:text-white transition-colors cursor-grab active:cursor-grabbing"
      aria-label="Drag to reorder"
    >
      <DragHandle />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`relative select-none transition-opacity ring-2 ring-binding/40 rounded-lg ${isDragging ? 'opacity-40' : ''}`}
    >
      <BookCard book={book} coverOverlay={overlay} compact={compact} hideActions />
    </div>
  );
}

const VALID_TABS = new Set(['reading', 'finished', 'unread', 'owned', 'prev_owned', 'never_owned', 'all', 'archived']);

export default function Library() {
  const [searchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const saved = getSaved();

  const [tab,         setTab]         = useState(() => (urlTab && VALID_TABS.has(urlTab)) ? urlTab : (saved.tab || 'reading'));
  const [queryRaw,    setQueryRaw]    = useState(() => saved.query || '');
  const [query,       setQuery]       = useState(() => saved.query || '');
  const [filtersOpen, setFiltersOpen] = useState(() => saved.filtersOpen ?? false);
  const [filters,     setFilters]     = useState(() => saved.filters ? { ...EMPTY_FILTERS, ...saved.filters } : EMPTY_FILTERS);
  // Per-tab sort memory: each tab earns its own preferred sort. Reading might
  // sit on 'last_logged' while All sits on 'updated' — switching tabs swaps
  // the dropdown to that tab's last choice instead of dragging one global
  // sort across the whole library.
  const [sortByTab, setSortByTab] = useState(() => {
    if (saved.sortByTab && typeof saved.sortByTab === 'object') return saved.sortByTab;
    // Migrate from the legacy single-sort key so the user's last selection
    // survives the upgrade. Lands under whichever tab they were on; other
    // tabs default to 'updated' lazily on first visit.
    const initialTab = (urlTab && VALID_TABS.has(urlTab)) ? urlTab : (saved.tab || 'reading');
    return saved.sort ? { [initialTab]: saved.sort } : {};
  });
  // Coerce a stale saved density of 'list' to 'comfortable' — the list view
  // is currently disabled (see commented-out toggle button and JSX below) and
  // GRID['list'] is undefined, which would break the className expression.
  const [density,     setDensity]     = useState(() => {
    const d = saved.density || 'comfortable';
    return d === 'list' ? 'comfortable' : d;
  });

  // Read/write the per-tab sort as if it were a single piece of state. The
  // setter always keys by the *current* tab — switching tabs first then
  // calling setSort would write to the new tab, which is the right behaviour
  // since the only call sites set sort *for the tab the user is on*.
  const sort = sortByTab[tab] || 'updated';
  function setSort(value) {
    const resolved = typeof value === 'function' ? value(sortByTab[tab] || 'updated') : value;
    setSortByTab(prev => ({ ...prev, [tab]: resolved }));
  }

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Refetch counter — bumps when the tab regains focus so newly-added
  // books from another window/process appear without a manual reload.
  const refreshTick = useRefreshTick();

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

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryRaw), 300);
    return () => clearTimeout(timer);
  }, [queryRaw]);

  // Persist UI state
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ tab, query: queryRaw, filtersOpen, filters, sortByTab, density }));
  }, [tab, queryRaw, filtersOpen, filters, sortByTab, density]);

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
    api.getBookFacets(buildApiParams(tab, sort, filters, query, 0))
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
    setLoading(true);
    setFetchError(false);
    setBooks([]);
    // Reset pagination flags + action banner: a refresh-tick / sort / tab
    // / filter / query change that fires while loadMore/loadAll is in
    // flight would otherwise strand the flags at true (their finally
    // clauses are gated on gen match) and leave the previous failure
    // banner sitting above the freshly-loaded list.
    setLoadingMore(false);
    setLoadingAll(false);
    setActionError(null);
    loadedRef.current = 0;
    api.getBooks(buildApiParams(tab, sort, filters, query, 0)).then(({ books: b, total: t }) => {
      if (stale) return;
      setBooks(b);
      setTotal(t);
      loadedRef.current = b.length;
    }).catch(() => { if (!stale) setFetchError(true); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [tab, sort, filters, query, refreshTick]);

  function handleLoadMore() {
    // Mirror the disabled button. React batches state updates, so two
    // rapid clicks before the next render both see loadingMore=false and
    // would otherwise fire duplicate requests at the same offset, then
    // each appends the same books and bumps loadedRef twice.
    if (loadingMore || loadingAll) return;
    const gen = genRef.current;
    setLoadingMore(true);
    setActionError(null);
    api.getBooks(buildApiParams(tab, sort, filters, query, loadedRef.current)).then(({ books: b, total: t }) => {
      if (gen !== genRef.current) return;
      setBooks(prev => [...prev, ...b]);
      setTotal(t);
      loadedRef.current += b.length;
    }).catch(() => {
      if (gen === genRef.current) setActionError('Failed to load more books.');
    }).finally(() => { if (gen === genRef.current) setLoadingMore(false); });
  }

  async function handleLoadAll() {
    if (loadingMore || loadingAll) return;
    const gen = genRef.current;
    setLoadingAll(true);
    setActionError(null);
    try {
      let serverTotal = total;
      while (gen === genRef.current && loadedRef.current < serverTotal) {
        const { books: b, total: t } = await api.getBooks(buildApiParams(tab, sort, filters, query, loadedRef.current));
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
      if (gen === genRef.current) setLoadingAll(false);
    }
  }

  function handleProgressUpdate(updated) {
    const statusTabs = ['reading', 'finished', 'unread'];
    const removing = statusTabs.includes(tab) && updated.status !== tab;
    if (removing) {
      // Bail if the book is no longer in local state — back-to-back
      // status patches (a finish auto-transition followed by another
      // edit) would otherwise double-decrement counters for a book
      // already filtered out. Clamps below back-stop the same desync.
      if (!books.some(b => b.id === updated.id)) return;
      loadedRef.current = Math.max(0, loadedRef.current - 1);
      setTotal(t => Math.max(0, t - 1));
      setBooks(bs => bs.filter(b => b.id !== updated.id));
    } else if (sort === 'updated') {
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
    : buildDisplayItems(books, density === 'list' ? new Set() : expandedSeries);
  const gridCols        = useGridCols(density === 'compact' ? COMPACT_BPS : COMFORTABLE_BPS);
  const hasMore         = loadedRef.current < total;
  // Mid-pagination, hide a trailing partial row so the visible grid always
  // ends on a full row of real books. The hidden stragglers re-emerge on the
  // next Load more when their row is filled in by fresh books. At end of
  // dataset, show everything — a partial last row is fine since there's
  // nothing more to load.
  // Guard: only trim when there's at least one full row to keep — otherwise
  // pathologically small loads (e.g. heavy series collapse → 5 items) would
  // hide everything and the user would see an empty grid.
  const trimTrailing  = hasMore && density !== 'list' && gridCols > 0 && allDisplayItems.length > gridCols
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
                  className={`px-5 py-2 text-sm rounded-md whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 active:scale-[0.98] ${
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
            {tab === 'never_owned' && (
              <button
                onClick={toggleEditMode}
                className={`text-sm px-3 py-2 rounded-lg whitespace-nowrap transition-colors ${
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
                onChange={(e) => setQueryRaw(e.target.value)}
                onKeyDown={(e) => {
                  // Enter flushes the 300ms debounce — keyboard users get
                  // the snappy feedback they expect from a "submit" key.
                  if (e.key === 'Enter') { e.preventDefault(); setQuery(queryRaw); }
                }}
                placeholder="Search title, people, series, or tags…"
                className="w-full bg-neutral-800 border border-leather/30 rounded-lg pl-4 pr-10 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-leather/70 focus:ring-1 focus:ring-oak/25 transition-colors duration-150 [&::-webkit-search-cancel-button]:appearance-none"
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                <SearchHelp />
              </div>
            </div>
            <button
              onClick={() => setFiltersOpen(o => !o)}
              className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 active:scale-[0.98] ${
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
              <button onClick={() => setDensity('comfortable')} title="Comfortable grid" className={`transition-colors ${density === 'comfortable' ? 'text-neutral-300' : 'text-neutral-700 hover:text-neutral-400'}`}>
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                  <rect x="1" y="1" width="4" height="4" rx="0.5"/><rect x="6" y="1" width="4" height="4" rx="0.5"/><rect x="11" y="1" width="4" height="4" rx="0.5"/>
                  <rect x="1" y="6" width="4" height="4" rx="0.5"/><rect x="6" y="6" width="4" height="4" rx="0.5"/><rect x="11" y="6" width="4" height="4" rx="0.5"/>
                  <rect x="1" y="11" width="4" height="4" rx="0.5"/><rect x="6" y="11" width="4" height="4" rx="0.5"/><rect x="11" y="11" width="4" height="4" rx="0.5"/>
                </svg>
              </button>
              <button onClick={() => setDensity('compact')} title="Compact grid" className={`transition-colors ${density === 'compact' ? 'text-neutral-300' : 'text-neutral-700 hover:text-neutral-400'}`}>
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                  <rect x="1" y="1" width="6.5" height="6.5" rx="0.5"/><rect x="8.5" y="1" width="6.5" height="6.5" rx="0.5"/>
                  <rect x="1" y="8.5" width="6.5" height="6.5" rx="0.5"/><rect x="8.5" y="8.5" width="6.5" height="6.5" rx="0.5"/>
                </svg>
              </button>
              {/* List view disabled — preserved here in case it's revived later.
              <button onClick={() => setDensity('list')} title="List view" className={`transition-colors ${density === 'list' ? 'text-neutral-300' : 'text-neutral-700 hover:text-neutral-400'}`}>
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                  <rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/>
                </svg>
              </button>
              */}
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
          <p className="text-xs text-warn mt-3 pt-4 border-t border-neutral-800/60">
            Failed to load filter options.
          </p>
        )}
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
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
          {/* List view disabled — preserved here in case it's revived later.
              Original ternary wrapped this grid branch alongside:
                density === 'list' ? (
                  <div className="divide-y divide-neutral-800/50">
                    {displayItems.map(item =>
                      item.type === 'series' ? (
                        <div key={item.name}>
                          <button onClick={() => toggleSeries(item.name)} className="flex items-center gap-2 py-1.5 px-2 w-full hover:bg-neutral-800/50 rounded transition-colors text-left">
                            <span className="text-xs text-neutral-600">{expandedSeries.has(item.name) ? '▾' : '▸'}</span>
                            <span className="text-sm text-neutral-400 flex-1 truncate">{item.name}</span>
                            <span className="text-xs text-neutral-600">{item.books.length} books</span>
                          </button>
                          {expandedSeries.has(item.name) && (
                            <div className="pl-4">
                              {sortVolumes(item.books).map(book => <ListRow key={book.id} book={book} />)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <ListRow key={item.book.id} book={item.book} />
                      )
                    )}
                  </div>
                ) : ( ...the grid branch below... )
              The toggle button that selected this view is also commented out
              up in the density toolbar. To revive: restore the ternary, the
              toggle button, and remove the 'list' coercion in getSaved(). */}
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
              {actionError && <p className="text-xs text-warn">{actionError}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
