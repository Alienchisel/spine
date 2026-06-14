import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, useLocation, Link } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import { plural, initialsFor } from '../utils.js';
import BookCard from '../components/BookCard.jsx';
import CoverSizeSlider from '../components/CoverSizeSlider.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useCoverSize } from '../hooks/useCoverSize.js';
import { useFreshFetch } from '../hooks/useFreshFetch.js';
import { useSpineEvent, dispatchSpineEvent } from '../hooks/useSpineEvent.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import { useLatest } from '../hooks/useLatest.js';
import { sectionEyebrow } from '../components/textStyles.js';

function SortableShelfCover({ book, linkState, focused }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      data-book-id={book.id}
      className={`flex-shrink-0 select-none transition-opacity ${isDragging ? 'opacity-40' : ''} ${focused ? 'ring-2 ring-oak rounded animate-pulse' : ''}`}
    >
      <div className="relative group">
        <Link to={`/books/${book.id}`} state={linkState} draggable={false} className="block">
          {/* Hover treatment matches BookCard: 2px white inset frame on
              the cover via a sibling overlay (the inset shadow on the
              frame itself would be hidden behind the img per CSS painting
              order). */}
          <div className={`relative w-[240px] ${book.format === 'audiobook' ? 'h-[240px]' : 'h-[360px]'} rounded overflow-hidden bg-neutral-800 shadow-lg`}>
            {book.cover_path
              ? <img src={book.cover_path} alt={book.title} draggable={false} loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-neutral-700 to-neutral-900 gap-2">
                  <span className="text-5xl font-bold text-neutral-500 leading-none tracking-wide">{initialsFor(book.title)}</span>
                  <span className="text-xs text-neutral-400 leading-tight line-clamp-4 text-center">{book.title}</span>
                </div>}
            <div className="pointer-events-none absolute inset-0 rounded ring-2 ring-inset ring-binding/25 group-hover:ring-[#ffffff99] transition-[box-shadow] duration-200" />
          </div>
        </Link>
        <button
          type="button"
          {...listeners}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded px-2 py-1 text-neutral-500 hover:text-neutral-200 transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label="Drag to reorder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}

const PROXIMITY_LABEL = { home: 'Home', nearby: 'Nearby', remote: 'Remote' };

// Parse a ?b=/?r=/?u=/?s= URL param. Anything that isn't a positive
// integer (missing, "abc", "0", "-1", "1.5") becomes null so callers
// don't fan out NaN into find() lookups and API calls.
function parseIdParam(params, key) {
  const raw = params.get(key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Walks the b → r → u → s chain against the loaded tree, returning false
// at the first level whose id doesn't resolve. Used to gate the
// location-books fetch so a stale ?b=999 doesn't briefly fire a doomed
// API call in the same render that the prune effect rewrites the URL.
function pathResolves(tree, buildingId, roomId, unitId, shelfId) {
  // Reject orphaned child ids before any tree work — a hand-typed or
  // stale URL like ?r=123 with no ?b= would otherwise short-circuit on
  // !buildingId and let getRoomBooks(123) fire one render before the
  // prune effect rewrites to root.
  if (roomId && !buildingId) return false;
  if (unitId && (!buildingId || !roomId)) return false;
  if (shelfId && (!buildingId || !roomId || !unitId)) return false;
  if (!buildingId) return true;
  const building = tree.find(b => b.id === buildingId);
  if (!building) return false;
  if (!roomId) return true;
  const room = building.rooms.find(r => r.id === roomId);
  if (!room) return false;
  if (!unitId) return true;
  const unit = room.units.find(u => u.id === unitId);
  if (!unit) return false;
  if (!shelfId) return true;
  return !!unit.shelves.find(s => s.id === shelfId);
}

function LevelCard({ primary, secondary, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left w-full bg-neutral-900 border border-neutral-800 rounded-lg p-4 hover:border-neutral-600 hover:bg-neutral-800/50 transition-colors group"
    >
      <p className="font-medium text-white group-hover:text-parchment transition-colors">{primary}</p>
      {secondary && <p className="text-xs text-neutral-500 mt-0.5">{secondary}</p>}
    </button>
  );
}

// Drag wrappers for the "drop an unfiled book onto a building" gesture on
// the root view. The whole BookCard is the activator — distance:5 on the
// PointerSensor lets inner clicks (cover Link, hover-tray buttons) still
// fire as long as the user doesn't drift past the threshold. opacity-40
// on the source mirrors SortableShelfCover; the DragOverlay renders a
// full-opacity ghost at the cursor for the actual follow-feel.
function DraggableUnshelfedCard({ book, compact, linkState }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book-${book.id}`,
    data: { kind: 'book', bookId: book.id },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`select-none ${isDragging ? 'opacity-40' : ''}`}
    >
      <BookCard book={book} compact={compact} linkState={linkState} />
    </div>
  );
}

function DroppableBuildingCard({ building, onClick }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `building-${building.id}`,
    data: { kind: 'building', buildingId: building.id },
  });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg transition-shadow ${isOver ? 'ring-2 ring-oak shadow-lg shadow-oak/20' : ''}`}
    >
      <LevelCard
        primary={building.name}
        secondary={[PROXIMITY_LABEL[building.proximity], plural(building.rooms.length, 'room'), building.book_count > 0 && plural(building.book_count, 'book')].filter(Boolean).join(' · ')}
        onClick={onClick}
      />
    </div>
  );
}

function ShelfRow({ shelf, books, onReorder, onLabelClick, linkState }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = books.findIndex(b => b.id === active.id);
    const newIdx = books.findIndex(b => b.id === over.id);
    // Either id missing from the current list (stale drag event, list
    // mutated mid-drag, etc.) → bail. Without this, arrayMove with -1
    // produces a malformed array and the reorder PUT sends wrong ids.
    if (oldIdx < 0 || newIdx < 0) return;
    onReorder(shelf.id, arrayMove(books, oldIdx, newIdx));
  }

  return (
    <div className="mb-8 last:mb-0">
      <div className="flex items-baseline gap-3 mb-2 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onLabelClick}
          className={`${sectionEyebrow} hover:text-neutral-300 transition-colors`}
        >
          {shelf.label}
        </button>
        <span className="text-xs text-neutral-700 tabular-nums">{books.length}</span>
      </div>
      {books.length === 0 ? (
        <p className="text-neutral-700 text-xs italic px-4 sm:px-6 lg:px-8">empty</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={books.map(b => b.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-4 overflow-x-auto pb-4 px-4 sm:px-6 lg:px-8 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-neutral-800 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-600 [&::-webkit-scrollbar-thumb]:rounded-full">
              {books.map(book => <SortableShelfCover key={book.id} book={book} linkState={linkState} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// Search-and-place existing books at the current location. Mirrors
// ListDetail's QuickAdd shape (debounced /api/books search → click a
// row to commit), but scoped to owned physical books since only those
// are shelvable per repository.js's isShelvable gate. Adding a book
// that's currently placed somewhere else surfaces the move ("from
// {prior location} → {target}") so a misclick can't silently relocate
// a book the user wasn't thinking about.
function AddBookHere({ targetPatch, targetLabel, resolveLocation, onAdded }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const searchGuard = useStaleGuard();
  const pickGuard = useActionGuard();
  const debounce = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    const term = q.trim();
    if (!term) {
      searchGuard.next();
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const epoch = searchGuard.next();
    debounce.current = setTimeout(async () => {
      try {
        // tab=owned + formats=physical = the shelvable cohort. Server
        // would silently NULL the location for any other format so
        // filtering here keeps the dropdown honest.
        const { books } = await api.getBooks({ q: term, tab: 'owned', formats: 'physical', limit: 6 });
        if (!searchGuard.isFresh(epoch)) return;
        setMatches(books || []);
      } catch {
        if (!searchGuard.isFresh(epoch)) return;
        setMatches([]);
      } finally {
        if (searchGuard.isFresh(epoch)) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(debounce.current);
  }, [q]);

  async function pick(book) {
    if (!pickGuard.begin()) return;
    setError(null);
    try {
      const updated = await api.patchBook(book.id, targetPatch);
      onAdded(updated);
      setQ('');
      setMatches([]);
      inputRef.current?.focus();
    } catch (err) {
      setError(err?.message || 'Failed to place book.');
    } finally {
      pickGuard.end();
    }
  }

  return (
    <div className="mb-6 relative">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Add a book to ${targetLabel} — search the library…`}
          aria-label={`Add a book to ${targetLabel}`}
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors flex-1"
        />
        {error && <span role="alert" className="text-xs text-warn">{error}</span>}
      </div>

      {q.trim() && (matches.length > 0 || searching) && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1.5 bg-neutral-900 border border-neutral-800 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {searching && matches.length === 0 ? (
            <div className="px-3 py-3 text-xs text-neutral-500">Searching the library…</div>
          ) : (
            matches.map(b => {
              const priorLabel = resolveLocation(b);
              // /api/books list rows carry the authors array, not the
              // pre-joined string. Same shape as ListDetail's QuickAdd
              // dropdown — render via inline join.
              const authorsLabel = (b.authors || []).map(a => a.name).join(', ');
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => pick(b)}
                  disabled={pickGuard.busy}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-neutral-800 disabled:cursor-default"
                >
                  <div className="w-8 h-12 flex-shrink-0 bg-neutral-800 rounded-sm overflow-hidden">
                    {b.cover_path && <img src={b.cover_path} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-parchment truncate">{b.title}</div>
                    {authorsLabel && <div className="text-xs text-neutral-500 truncate">{authorsLabel}</div>}
                  </div>
                  <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                    {priorLabel ? `Move from ${priorLabel}` : `+ Place here`}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function ShelfView() {
  const [params, setParams] = useSearchParams();
  // Captured for setParams calls so internal navigation (breadcrumb
  // clicks, URL-normalisation effect) doesn't wipe the incoming
  // location.state ('← Stats' / '← Library' etc.).
  const { state: navState } = useLocation();
  // treeLoaded gates the URL-pruning effect: we only consider the tree
  // canonical (and therefore safe to use as a basis for stripping stale
  // ids out of the URL) once getShelfTree has actually succeeded. On a
  // failed fetch tree stays [] but treeLoaded stays false, so a
  // bookmarked deep link survives a transient network error. Side-set
  // inside the fetch fn since the hook can't distinguish "haven't
  // fetched yet" from "fetched and got empty".
  const [treeLoaded, setTreeLoaded] = useState(false);
  const {
    data: tree,
    setData: setTree,
    loading,
    error: treeLoadError,
    setError: setTreeLoadError,
    refetch: refetchTree,
  } = useFreshFetch(
    () => api.getShelfTree().then(t => { setTreeLoaded(true); return t; }),
    [],
    { initialData: [] },
  );
  // Supplementary fetch: shouldn't gate the tree on its slowness, and
  // its failure renders a smaller-scope warning rather than wiping the
  // page.
  const {
    data: unshelfed,
    setData: setUnshelfed,
    error: unshelfedError,
    refetch: refetchUnshelfed,
  } = useFreshFetch(
    () => api.getUnshelfedBooks(),
    [],
    { initialData: [] },
  );
  // Action errors (failed reorder, failed placement) share the
  // ErrorBanner with the tree/location-books load errors. setError wraps
  // all three so the ~10 callsites in action handlers stay identical
  // (same shape as ShelfManager). Filled in after the location-books
  // hook destructure below.
  const [actionError, setActionError] = useState(null);
  const { size: coverSize, setSize: setCoverSize, compact, gridStyle, gridClassName, MIN: coverMin, MAX: coverMax } = useCoverSize();
  // Reveal-from-BookDetail target. When a book detail's "Reveal" link
  // navigates here it appends &focus=<bookId>; we scroll that book into
  // view once it's rendered and ring it briefly so the eye lands on it
  // inside a long shelf row.
  const focusId = params.get('focus');
  // True for ~2s after the focus scroll fires — drives the ring pulse
  // on the matching cover. Cleared via timeout so the highlight doesn't
  // persist once the user has visually anchored to it.
  const [showFocusRing, setShowFocusRing] = useState(false);
  // Track which focusId we've already revealed, so a refresh-tick
  // re-fetch of `books` doesn't re-scroll the user back after they've
  // manually scrolled away. Reset when `focusId` itself changes (new
  // Reveal click) so a different target lands correctly.
  const revealedRef = useRef(null);
  // Bumped on every drag so an earlier failed reorder whose recovery
  // refetch lands *after* a later drag has already applied optimistically
  // can detect that it's stale — without this, A's getShelfBooks/
  // getUnitBooks response would clobber B's newer optimistic order with
  // the pre-A server state. Mirrors the seq guard in Readlist /
  // ListDetail.
  const reorderSeqRef = useRef(0);

  const buildingId = parseIdParam(params, 'b');
  const roomId     = parseIdParam(params, 'r');
  const unitId     = parseIdParam(params, 'u');
  const shelfId    = parseIdParam(params, 's');

  // Back-link state for BookDetail: returning to /shelf-view restores the
  // current search params so the user lands on the same building/room/unit/
  // shelf they came from, not the root view.
  const fromState = useMemo(() => {
    const qs = params.toString();
    return { from: 'Shelves', fromPath: qs ? `/shelf-view?${qs}` : '/shelf-view' };
  }, [params]);
  // Per-grid cohort builder. Each rendering surface in this page has its
  // own scope (a shelf, a per-room or per-unit group, the unfiled bucket,
  // etc.) so prev/next on BookDetail should walk that surface's books, not
  // the whole page's mixed contents. Cheap object spread; called inline
  // at each render site so the cohort matches the books that grid is
  // about to lay out.
  function cohortLinkState(cohortBooks) {
    return { ...fromState, cohort: cohortBooks.map(b => ({ id: b.id, title: b.title })) };
  }

  // Memoised so the books-fetch effect can depend on the boolean instead of
  // the whole `tree` array. A refresh-tick refetch produces a new tree
  // reference each time; without this, the books effect would fire twice
  // per tick (once for refreshTick, again when setTree updates) even when
  // the path's resolution hasn't changed. pathOk only flips when actual
  // resolution changes, so primitive equality dedupes the no-op case.
  const pathOk = useMemo(
    () => pathResolves(tree, buildingId, roomId, unitId, shelfId),
    [tree, buildingId, roomId, unitId, shelfId],
  );

  // Composite key for the location-books fetch. The readiness bit ('1'/
  // '0' prefix) flips on the treeLoaded+pathOk transition so the hook
  // treats it as a real navigation — wipe + skeleton + fetch — instead
  // of a silent refetch. Without that bit, treeLoaded flipping from
  // false to true wouldn't change the key, the hook wouldn't show the
  // skeleton, and the user would see an empty grid for one paint frame
  // before the actual fetch resolved.
  const locationKey = `${treeLoaded && pathOk ? '1' : '0'}|${buildingId || ''}|${roomId || ''}|${unitId || ''}|${shelfId || ''}`;
  // Action handlers compare the captured locationKey against this ref
  // at response time to drop recovery refetches that came back after
  // the user navigated to another shelf/room/etc. Replaces the prior
  // booksGuard.current() / .isFresh() pattern — locationKey strictly
  // dominates booksGuard semantically (the guard only ever bumped on
  // deps changes, which is exactly what locationKey changes encode).
  const locationKeyRef = useLatest(locationKey);

  const {
    data: books,
    setData: setBooks,
    loading: booksLoading,
    error: locationBooksError,
    setError: setLocationBooksError,
    refetch: refetchLocationBooks,
  } = useFreshFetch(
    () => {
      // Returning Promise.resolve([]) for the non-fetch branches keeps
      // the hook's lifecycle uniform — books wipe to [], loading goes
      // false fast, no real API call fires. Mirrors the original effect's
      // early-return-with-setBooks([]) branches.
      if (!buildingId && !roomId && !unitId && !shelfId) return Promise.resolve([]);
      if (!treeLoaded || !pathOk) return Promise.resolve([]);
      return shelfId  ? api.getShelfBooks(shelfId)
        : unitId      ? api.getUnitBooks(unitId)
        : roomId      ? api.getRoomBooks(roomId)
        :               api.getBuildingBooks(buildingId);
    },
    [buildingId, roomId, unitId, shelfId, treeLoaded, pathOk],
    { key: locationKey, wipeOnKeyChange: true, initialData: [] },
  );

  // Sync on any book mutation dispatched from another surface (most
  // notably MoreMenu's Location picker, which PATCHes shelf_id /
  // unit_id / room_id / building_id from the card's three-dot menu).
  // Three things can drift: the tree's per-level book_counts, the
  // unshelfed-books list (book just joined or left it), and the
  // current location's visible books (book may have entered or left
  // this grid). Refetching all three is cheap and keeps the page
  // honest. Same idiom Library uses for spine:book-mutated.
  useSpineEvent('spine:book-mutated', () => {
    refetchTree();
    refetchUnshelfed();
    refetchLocationBooks();
  });
  // Book-deleted from anywhere — same surfaces drift, same response.
  useSpineEvent('spine:book-deleted', () => {
    refetchTree();
    refetchUnshelfed();
    refetchLocationBooks();
  });

  // Three error sources share the ErrorBanner slot. Priority: action
  // (most recent user-driven failure) → tree (page-level) → location
  // (specific to the current grid). The setError wrapper clears all
  // three so the ~10 setError(null) callsites in handlers dismiss any
  // prior banner regardless of source.
  const error = actionError
    ?? (treeLoadError ? 'Failed to load shelves.' : null)
    ?? (locationBooksError ? 'Failed to load books at this location.' : null);
  function setError(msg) {
    setActionError(msg);
    setTreeLoadError(null);
    setLocationBooksError(null);
  }

  // Scroll-to-focus: once books are rendered and the focus target is
  // among them, scroll the row to center it. Fires once per focusId.
  useEffect(() => {
    if (!focusId) return;
    if (booksLoading) return;
    if (revealedRef.current === focusId) return;
    const el = document.querySelector(`[data-book-id="${focusId}"]`);
    if (!el) return;
    revealedRef.current = focusId;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    setShowFocusRing(true);
    const t = setTimeout(() => setShowFocusRing(false), 2000);
    return () => clearTimeout(t);
  }, [focusId, booksLoading, books]);

  useEffect(() => {
    // Once the tree is canonical, walk b → r → u → s and prune anything
    // past the first level that doesn't resolve. Covers stale bookmarks
    // (a shelf that's since been deleted) AND junk values that slipped
    // past parseIdParam-as-positive-integer but aren't actual ids. Uses
    // replace: true so the cleanup doesn't pollute browser history.
    if (!treeLoaded) return;
    const next = {};
    if (buildingId) {
      const building = tree.find(b => b.id === buildingId);
      if (building) {
        next.b = String(buildingId);
        if (roomId) {
          const room = building.rooms.find(r => r.id === roomId);
          if (room) {
            next.r = String(roomId);
            if (unitId) {
              const unit = room.units.find(u => u.id === unitId);
              if (unit) {
                next.u = String(unitId);
                if (shelfId && unit.shelves.find(s => s.id === shelfId)) {
                  next.s = String(shelfId);
                }
              }
            }
          }
        }
      }
    }
    // Preserve any non-location params (e.g. `focus` from a BookDetail
    // Reveal link) — those aren't managed by this prune pass.
    const preserveKeys = ['focus'];
    for (const k of preserveKeys) {
      const v = params.get(k);
      if (v != null) next[k] = v;
    }
    // Compare against raw params (not the parsed ids) so that "?b=abc"
    // — which yields buildingId=null but isn't an empty URL — gets
    // rewritten too. Without the diff check this effect would loop on
    // every render that already matches.
    const keys = ['b', 'r', 'u', 's', ...preserveKeys];
    const diff = keys.some(k => (params.get(k) ?? '') !== (next[k] ?? ''));
    if (diff) setParams(next, { replace: true, state: navState });
  }, [treeLoaded, tree, buildingId, roomId, unitId, shelfId, params, setParams]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = books.findIndex(b => b.id === active.id);
    const newIndex = books.findIndex(b => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(books, oldIndex, newIndex);
    setBooks(reordered);
    setError(null);
    // Capture the current location so the recovery refetch (and its
    // error setters) can be dropped if the user has navigated to a
    // different shelf/room/etc. by the time the reorder PUT resolves.
    // Without this, a stale `setBooks(...)` from the recovery would
    // clobber the new location's just-loaded books.
    const startLocation = locationKeyRef.current;
    // Capture the reorder seq so an earlier failed PUT whose recovery
    // refetch lands after a later drag's optimistic apply doesn't snap
    // pre-A server state over B's newer order.
    const reorderSeq = ++reorderSeqRef.current;
    api.reorderShelf(shelfId, reordered.map(b => b.id))
      .catch(() => {
        if (locationKeyRef.current !== startLocation || reorderSeq !== reorderSeqRef.current) return;
        // Always tell the user their reorder didn't save — even when the
        // recovery refetch succeeds and the canonical order snaps back into
        // place, otherwise the snap-back looks like the drag never
        // registered. If the refetch ALSO fails we upgrade the message so
        // the user knows to refresh manually.
        setError('Failed to save reorder.');
        api.getShelfBooks(shelfId)
          .then(b => { if (locationKeyRef.current === startLocation && reorderSeq === reorderSeqRef.current) setBooks(b); })
          .catch(() => { if (locationKeyRef.current === startLocation && reorderSeq === reorderSeqRef.current) setError('Reorder failed and could not be reverted — refresh the page.'); });
      });
  }

  // Drag-to-place: root-view gesture that moves a book from the "No
  // location assigned" bucket onto a building tile via a PATCH of
  // { building_id }. The drag is wired up only at the root view; deeper
  // levels still use MoreMenu's Location… picker for placement and
  // AddBookHere for search-and-place. activeUnshelfedBookId drives the
  // DragOverlay ghost; null when no drag is in flight.
  const [activeUnshelfedBookId, setActiveUnshelfedBookId] = useState(null);
  const activeUnshelfedBook = activeUnshelfedBookId
    ? unshelfed.find(b => b.id === activeUnshelfedBookId)
    : null;

  function handleUnshelfedDragStart(event) {
    if (event.active.data?.current?.kind === 'book') {
      setActiveUnshelfedBookId(event.active.data.current.bookId);
    }
  }

  async function handleUnshelfedDragEnd(event) {
    setActiveUnshelfedBookId(null);
    const { active, over } = event;
    if (!over) return;
    if (active.data?.current?.kind !== 'book') return;
    if (over.data?.current?.kind !== 'building') return;
    const bookId = active.data.current.bookId;
    const targetBuildingId = over.data.current.buildingId;
    setError(null);
    // Optimistically drop the book from the unfiled bucket so the gesture
    // feels instant. The dispatched event triggers the existing
    // spine:book-mutated listener (refetchTree + refetchUnshelfed +
    // refetchLocationBooks), which reconciles to canonical state shortly
    // after — including the tree's book_count bump on the target building.
    setUnshelfed(prev => prev.filter(b => b.id !== bookId));
    try {
      await api.patchBook(bookId, { building_id: targetBuildingId });
      dispatchSpineEvent('spine:book-mutated', { id: bookId });
    } catch {
      setError('Failed to place book.');
      refetchUnshelfed();
    }
  }

  const building = tree.find(b => b.id === buildingId);
  const rooms    = building?.rooms ?? [];
  const room     = rooms.find(r => r.id === roomId);
  const units    = room?.units ?? [];
  const unit     = units.find(u => u.id === unitId);
  const shelves  = unit?.shelves ?? [];
  const shelf    = shelves.find(s => s.id === shelfId);

  // AddBookHere wiring: target patch (the most-specific non-null id
  // takes the placement, mirroring normalizeBookLocation server-side),
  // a human label for the input placeholder, and a resolver that turns
  // a candidate book's location-id chain into a short breadcrumb
  // ("Grey 2 · Shelf 3") for the "Move from X" suffix on matched rows.
  // Only active inside a specific location — the root view shows the
  // building grid and has no single placement target.
  const addTarget = useMemo(() => {
    if (shelfId)    return { patch: { shelf_id: shelfId },       label: shelf?.label ?? 'this shelf' };
    if (unitId)    return { patch: { unit_id: unitId },         label: unit?.name   ?? 'this unit'  };
    if (roomId)    return { patch: { room_id: roomId },         label: room?.name   ?? 'this room'  };
    if (buildingId) return { patch: { building_id: buildingId }, label: building?.name ?? 'this building' };
    return null;
  }, [shelfId, unitId, roomId, buildingId, shelf?.label, unit?.name, room?.name, building?.name]);

  const resolveLocation = useMemo(() => (book) => {
    const bits = [];
    const b = tree.find(x => x.id === book.building_id);
    const r = b?.rooms.find(x => x.id === book.room_id);
    const u = r?.units.find(x => x.id === book.unit_id);
    const s = u?.shelves.find(x => x.id === book.shelf_id);
    if (b) bits.push(b.name);
    if (r) bits.push(r.name);
    if (u) bits.push(u.name);
    if (s) bits.push(s.label);
    return bits.length ? bits.join(' · ') : null;
  }, [tree]);

  // Re-fetch the current location's books after a placement so the new
  // book lands at its server-assigned shelf_position (the optimistic
  // append-to-end is wrong if the server placed it elsewhere — which
  // happens for any shelf/unit with existing books) and any books that
  // were previously at this location but got moved elsewhere by the
  // PATCH drop out of view. The hook's refetch handles stale-response
  // dropping internally: if the user navigates before this resolves,
  // its epoch bumps and the response is dropped.
  function handleAddedToLocation() {
    refetchLocationBooks();
  }

  function nav(updates) {
    const next = {};
    if (updates.b != null) next.b = updates.b;
    if (updates.r != null) next.r = updates.r;
    if (updates.u != null) next.u = updates.u;
    if (updates.s != null) next.s = updates.s;
    setParams(next, { state: navState });
  }

  const crumbs = [
    { label: 'Shelves', action: () => setParams({}, { state: navState }) },
    building && { label: building.name, action: () => nav({ b: buildingId }) },
    room     && { label: room.name,     action: () => nav({ b: buildingId, r: roomId }) },
    unit     && { label: unit.name,     action: () => nav({ b: buildingId, r: roomId, u: unitId }) },
    shelf    && { label: shelf.label, action: null },
  ].filter(Boolean);

  if (loading) return <div role="status" className="text-neutral-700 text-sm">Loading…</div>;

  return (
    <div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4" />
      <div className="flex items-center justify-between mb-6">
        <nav className="flex items-center gap-1.5 text-sm text-neutral-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-neutral-800">/</span>}
              {c.action ? (
                <button type="button" onClick={c.action} className="hover:text-neutral-200 transition-colors">
                  {c.label}
                </button>
              ) : (
                <span className="text-white font-medium">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <CoverSizeSlider size={coverSize} onChange={setCoverSize} min={coverMin} max={coverMax} />
          <Link
            to="/shelf"
            className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
          >
            Manage shelves →
          </Link>
        </div>
      </div>

      {addTarget && (
        <AddBookHere
          targetPatch={addTarget.patch}
          targetLabel={addTarget.label}
          resolveLocation={resolveLocation}
          onAdded={handleAddedToLocation}
        />
      )}

      {/* Buildings */}
      {!buildingId && (
        tree.length === 0 ? (
          <div className="text-center py-32">
            <p className="text-neutral-600 mb-3">No shelves configured yet.</p>
            <Link to="/shelf" className="text-sm text-oak hover:text-leather">Manage shelves →</Link>
          </div>
        ) : (
          /* DndContext wraps both the building tiles and the unfiled
             bucket so a book card from the bucket can be dropped on any
             building tile. The shelf-detail view's own DndContext is
             unaffected — it sits inside the {shelfId && …} branch below
             and is mutually exclusive with this one. */
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleUnshelfedDragStart}
            onDragEnd={handleUnshelfedDragEnd}
            onDragCancel={() => setActiveUnshelfedBookId(null)}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tree.map(b => (
                <DroppableBuildingCard
                  key={b.id}
                  building={b}
                  onClick={() => nav({ b: b.id })}
                />
              ))}
            </div>

            {unshelfedError && (
              // Scoped warning for an unshelfed-books fetch failure — sits
              // where the section would otherwise render, so the user
              // knows what specifically is missing without the page-wide
              // "Failed to load shelves" being implied.
              <p role="alert" className="mt-10 text-xs text-warn">Failed to load unshelfed books.</p>
            )}
            {unshelfed.length > 0 && (
              <div className="mt-10">
                <div className="mb-4 pb-2 border-b border-neutral-800 flex items-baseline justify-between gap-3">
                  <h2 className={sectionEyebrow}>
                    No location assigned · {unshelfed.length}
                  </h2>
                  <p className="text-[11px] text-neutral-600">Drag onto a building to place</p>
                </div>
                <div className={gridClassName} style={gridStyle}>
                  {(() => {
                    const ls = cohortLinkState(unshelfed);
                    return unshelfed.map(book => (
                      <DraggableUnshelfedCard key={book.id} book={book} compact={compact} linkState={ls} />
                    ));
                  })()}
                </div>
              </div>
            )}
            {/* Cursor-follow ghost so the drag feels grabbed-and-moved
                rather than just fading-in-place. Rendered via portal to
                document.body by dnd-kit; styled to match the source
                card's opacity-100 (vs. the source's opacity-40). */}
            <DragOverlay dropAnimation={null}>
              {activeUnshelfedBook ? (
                <div className="pointer-events-none">
                  <BookCard book={activeUnshelfedBook} compact={compact} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )
      )}

      {/* Rooms + building-level books */}
      {buildingId && !roomId && (<>
        {rooms.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map(r => (
              <LevelCard
                key={r.id}
                primary={r.name}
                secondary={[plural(r.units.length, 'unit'), r.book_count > 0 && plural(r.book_count, 'book')].filter(Boolean).join(' · ')}
                onClick={() => nav({ b: buildingId, r: r.id })}
              />
            ))}
          </div>
        )}
        {booksLoading ? (
          <div role="status" className="text-neutral-700 text-sm mt-6">Loading…</div>
        ) : books.length > 0 && (() => {
          // Group the flat building-books list under per-room headers.
          // The SQL ORDER BY guarantees same-room books are adjacent, so a
          // single walk emits each group in order. Books pinned at the
          // building level (effective_room_id null) sort last and get a
          // "Unfiled · building level" header that can't collide with a
          // user-named room (no one would pick that as a room name).
          const groups = [];
          for (const book of books) {
            const last = groups[groups.length - 1];
            const rid = book.effective_room_id ?? null;
            if (last && last.id === rid) {
              last.books.push(book);
            } else {
              groups.push({
                id: rid,
                name: rid == null ? 'Unfiled · building level' : book.effective_room_name,
                books: [book],
              });
            }
          }
          return (
            <div className={rooms.length > 0 ? 'mt-8 space-y-6' : 'space-y-6'}>
              {groups.map(g => (
                <div key={g.id ?? 'unassigned'}>
                  <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">
                    {g.name} <span className="text-neutral-700">· {plural(g.books.length, 'book')}</span>
                  </p>
                  <div className={gridClassName} style={gridStyle}>
                    {(() => {
                      const ls = cohortLinkState(g.books);
                      return g.books.map(book => <BookCard key={book.id} book={book} compact={compact} linkState={ls} />);
                    })()}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        {!booksLoading && rooms.length === 0 && books.length === 0 && (
          <p className="text-neutral-600 text-sm">No books in this building yet.</p>
        )}
      </>)}

      {/* Units + room-level books */}
      {roomId && !unitId && (<>
        {units.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {units.map(u => (
              <LevelCard
                key={u.id}
                primary={u.name}
                secondary={[plural(u.shelves.length, 'shelf', 'shelves'), u.book_count > 0 && plural(u.book_count, 'book')].filter(Boolean).join(' · ')}
                onClick={() => nav({ b: buildingId, r: roomId, u: u.id })}
              />
            ))}
          </div>
        )}
        {booksLoading ? (
          <div role="status" className="text-neutral-700 text-sm mt-6">Loading…</div>
        ) : books.length > 0 && (() => {
          // Same per-unit grouping as the building view's per-room
          // headers — SQL ORDER BY keeps same-unit books adjacent, so a
          // single walk emits each group. Room-only books (no unit/shelf
          // pinned) sort last and get a "Unfiled · room level" header
          // that can't collide with a user-named unit.
          const groups = [];
          for (const book of books) {
            const last = groups[groups.length - 1];
            const uid = book.effective_unit_id ?? null;
            if (last && last.id === uid) {
              last.books.push(book);
            } else {
              groups.push({
                id: uid,
                name: uid == null ? 'Unfiled · room level' : book.effective_unit_name,
                books: [book],
              });
            }
          }
          return (
            <div className={units.length > 0 ? 'mt-8 space-y-6' : 'space-y-6'}>
              {groups.map(g => (
                <div key={g.id ?? 'unassigned'}>
                  <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-2">
                    {g.name} <span className="text-neutral-700">· {plural(g.books.length, 'book')}</span>
                  </p>
                  <div className={gridClassName} style={gridStyle}>
                    {(() => {
                      const ls = cohortLinkState(g.books);
                      return g.books.map(book => <BookCard key={book.id} book={book} compact={compact} linkState={ls} />);
                    })()}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        {!booksLoading && units.length === 0 && books.length === 0 && (
          <p className="text-neutral-600 text-sm">No books in this room yet.</p>
        )}
      </>)}

      {/* Shelves rendered as stacked horizontal rows + unit-level (shelfless) books */}
      {unitId && !shelfId && (<>
        {booksLoading ? (
          <div role="status" className="text-neutral-700 text-sm">Loading…</div>
        ) : (<>
          {(() => {
            // Unit-level unfiled books surface above the shelves loop so
            // the "appear first at every level" rule holds at the unit
            // view as it does at the room/building views (where SQL
            // ordering puts the unfiled bucket first). border-b + mb-6
            // separates this group from the heavier ShelfRow stack below.
            const unitOnly = books.filter(b => !b.shelf_id);
            if (unitOnly.length === 0) return null;
            return (
              <div className={shelves.length > 0 ? 'mb-6 pb-6 border-b border-neutral-800/50' : ''}>
                {shelves.length > 0 && (
                  <h2 className={`${sectionEyebrow} mb-4`}>Not on a shelf</h2>
                )}
                <div className={gridClassName} style={gridStyle}>
                  {(() => {
                    const ls = cohortLinkState(unitOnly);
                    return unitOnly.map(book => <BookCard key={book.id} book={book} compact={compact} linkState={ls} />);
                  })()}
                </div>
              </div>
            );
          })()}
          {shelves.length > 0 && (
            <div className="-mx-4 sm:-mx-6 lg:-mx-8">
              {shelves.map(s => {
                const shelfBooks = books.filter(b => b.shelf_id === s.id);
                return (
                <ShelfRow
                  key={s.id}
                  shelf={s}
                  books={shelfBooks}
                  linkState={cohortLinkState(shelfBooks)}
                  onLabelClick={() => nav({ b: buildingId, r: roomId, u: unitId, s: s.id })}
                  onReorder={(shelfId, reordered) => {
                    setBooks(prev => {
                      const others = prev.filter(b => b.shelf_id !== shelfId);
                      return [...others, ...reordered];
                    });
                    setError(null);
                    // Same navigation guard as handleDragEnd above — drop
                    // the recovery refetch and its error setters if the
                    // user has moved to a different location while the
                    // reorder was in flight. The seq guard adds protection
                    // against overlapping drags within this view (across
                    // any shelf row): A's failure recovery shouldn't snap
                    // pre-A unit-books over B's newer optimistic state.
                    const startLocation = locationKeyRef.current;
                    const reorderSeq = ++reorderSeqRef.current;
                    api.reorderShelf(shelfId, reordered.map(b => b.id))
                      .catch(() => {
                        if (locationKeyRef.current !== startLocation || reorderSeq !== reorderSeqRef.current) return;
                        setError('Failed to save reorder.');
                        api.getUnitBooks(unitId)
                          .then(b => { if (locationKeyRef.current === startLocation && reorderSeq === reorderSeqRef.current) setBooks(b); })
                          .catch(() => { if (locationKeyRef.current === startLocation && reorderSeq === reorderSeqRef.current) setError('Reorder failed and could not be reverted — refresh the page.'); });
                      });
                  }}
                />
                );
              })}
            </div>
          )}
          {shelves.length === 0 && books.length === 0 && (
            <p className="text-neutral-600 text-sm">No books in this unit yet.</p>
          )}
        </>)}
      </>)}

      {/* Shelf-level books */}
      {shelfId && (
        booksLoading ? (
          <div role="status" className="text-neutral-700 text-sm">Loading…</div>
        ) : books.length === 0 ? (
          <p className="text-neutral-600 text-sm">No books on this shelf yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={books.map(b => b.id)} strategy={horizontalListSortingStrategy}>
              <div className="relative -mx-4 sm:-mx-6 lg:-mx-8">
                {/* z-10 puts books in front of the absolute plank below, so the
                    cover bottoms visibly cover the plank's top edge — that's
                    what makes them read as "standing on" the surface. */}
                <div className="relative z-10 flex gap-4 overflow-x-auto pb-7 px-4 sm:px-6 lg:px-8 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-neutral-800 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-neutral-600 [&::-webkit-scrollbar-thumb]:rounded-full">
                  {(() => {
                    const ls = cohortLinkState(books);
                    return books.map(book => (
                      <SortableShelfCover
                        key={book.id}
                        book={book}
                        linkState={ls}
                        focused={showFocusRing && String(book.id) === focusId}
                      />
                    ));
                  })()}
                </div>
                {/* Skeuomorphic wood plank — disabled while we evaluate whether
                    the bookish surface earns its visual weight. To re-enable,
                    remove the surrounding `{false && (` / `)}`.
                {false && (
                  <div className="wood-shelf pointer-events-none absolute bottom-2 left-4 right-4 sm:left-6 sm:right-6 lg:left-8 lg:right-8 h-6 rounded-sm shadow-[0_5px_10px_-3px_rgba(0,0,0,0.6)]">
                    <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-black/55 to-transparent rounded-t-sm" />
                    <div className="absolute inset-x-0 top-0 h-px bg-leather/20" />
                    <div className="absolute inset-x-0 bottom-0 h-px bg-black/50" />
                  </div>
                )} */}
              </div>
            </SortableContext>
          </DndContext>
        )
      )}
    </div>
  );
}
