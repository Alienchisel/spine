import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

function SortableShelfCover({ book, linkState }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`flex-shrink-0 select-none transition-opacity ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="relative group">
        <Link to={`/books/${book.id}`} state={linkState} draggable={false} className="block">
          {/* Hover treatment matches BookCard: 2px white inset frame on
              the cover via a sibling overlay (the inset shadow on the
              frame itself would be hidden behind the img per CSS painting
              order). */}
          <div className={`relative w-[240px] ${book.format === 'audiobook' ? 'h-[240px]' : 'h-[360px]'} rounded overflow-hidden bg-neutral-800 shadow-lg`}>
            {book.cover_path
              ? <img src={book.cover_path} alt={book.title} draggable={false} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-end p-2 bg-gradient-to-br from-neutral-700 to-neutral-900">
                  <span className="text-xs text-neutral-400 leading-tight line-clamp-4">{book.title}</span>
                </div>}
            <div className="pointer-events-none absolute inset-0 rounded ring-2 ring-inset ring-binding/25 group-hover:ring-[#ffffff99] transition-[box-shadow] duration-200" />
          </div>
        </Link>
        <button
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
      onClick={onClick}
      className="text-left w-full bg-neutral-900 border border-neutral-800 rounded-lg p-4 hover:border-neutral-600 hover:bg-neutral-800/50 transition-colors group"
    >
      <p className="font-medium text-white group-hover:text-parchment transition-colors">{primary}</p>
      {secondary && <p className="text-xs text-neutral-500 mt-0.5">{secondary}</p>}
    </button>
  );
}

function plural(n, word, plural) {
  return `${n} ${n === 1 ? word : (plural ?? word + 's')}`;
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
          onClick={onLabelClick}
          className="text-xs font-semibold text-neutral-500 uppercase tracking-widest hover:text-neutral-300 transition-colors"
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

export default function ShelfView() {
  const [params, setParams] = useSearchParams();
  const [tree, setTree] = useState([]);
  // treeLoaded gates the URL-pruning effect: we only consider the tree
  // canonical (and therefore safe to use as a basis for stripping stale
  // ids out of the URL) once getShelfTree has actually succeeded. On a
  // failed fetch the tree stays [] but treeLoaded stays false, so a
  // bookmarked deep link survives a transient network error.
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [books, setBooks] = useState([]);
  const [unshelfed, setUnshelfed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [booksLoading, setBooksLoading] = useState(false);
  const [error, setError] = useState(null);
  // Distinct from page-level `error` so a flaky unshelfed fetch doesn't
  // wipe the shelf tree (which had loaded fine in parallel) and doesn't
  // surface as a misleading "Failed to load shelves" banner.
  const [unshelfedError, setUnshelfedError] = useState(null);
  // Stale-response guard for the location-books fetch. Bumped on every
  // location change AND on returns to the root view so an in-flight
  // request from a prior location can't setBooks after navigation.
  const booksGenRef = useRef(0);
  // Bumped on every drag so an earlier failed reorder whose recovery
  // refetch lands *after* a later drag has already applied optimistically
  // can detect that it's stale — without this, A's getShelfBooks/
  // getUnitBooks response would clobber B's newer optimistic order with
  // the pre-A server state. Mirrors the seq guard in Readlist /
  // ListDetail.
  const reorderSeqRef = useRef(0);
  const refreshTick = useRefreshTick();

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

  useEffect(() => {
    // Two independent fetches: the shelf tree is load-bearing (no tree =
    // no shelves to browse), the unshelfed-books list is supplementary
    // (only matters at the root view's "no location assigned" section).
    // Splitting also means `loading` tracks ONLY the shelf-tree fetch —
    // a slow unshelfed request shouldn't keep the whole page on
    // "Loading…" once the tree is ready. Unshelfed silently appears when
    // it resolves; on failure the smaller-scope warning replaces it.
    let stale = false;

    // Each .then clears its own scoped error so a refresh-tick retry that
    // succeeds drops a stale banner from the previous attempt; otherwise
    // the warning lingers above a freshly loaded tree / unshelfed list.
    api.getShelfTree()
      .then(t => { if (!stale) { setTree(t); setTreeLoaded(true); setError(null); } })
      .catch(() => { if (!stale) setError('Failed to load shelves.'); })
      .finally(() => { if (!stale) setLoading(false); });

    api.getUnshelfedBooks()
      .then(u => { if (!stale) { setUnshelfed(u); setUnshelfedError(null); } })
      .catch(() => { if (!stale) setUnshelfedError('Failed to load unshelfed books.'); });

    return () => { stale = true; };
  }, [refreshTick]);

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
    // Compare against raw params (not the parsed ids) so that "?b=abc"
    // — which yields buildingId=null but isn't an empty URL — gets
    // rewritten too. Without the diff check this effect would loop on
    // every render that already matches.
    const diff = ['b', 'r', 'u', 's'].some(k => (params.get(k) ?? '') !== (next[k] ?? ''));
    if (diff) setParams(next, { replace: true });
  }, [treeLoaded, tree, buildingId, roomId, unitId, shelfId, params, setParams]);

  useEffect(() => {
    // Bump the gen unconditionally — also on the root-view branch — so any
    // previous location's in-flight fetch is dropped when its response
    // arrives.
    const gen = ++booksGenRef.current;
    // Clear any prior load/reorder error so it doesn't haunt the next
    // location. Without this, a failed load at shelf A keeps showing its
    // warning after the user navigates to shelf B (or to root view).
    setError(null);
    if (!buildingId && !roomId && !unitId && !shelfId) {
      // Returning to the root view: drop the books grid AND clear
      // booksLoading. Without this, an in-flight location fetch from the
      // previous view ignores its `.finally` (gen mismatch) and leaves
      // booksLoading latched at true.
      setBooks([]);
      setBooksLoading(false);
      return;
    }
    // Defer the location fetch until the tree has loaded AND the URL
    // path resolves in it. When treeLoaded flips true with a stale
    // ?b=999, this effect and the prune effect run in the same render —
    // prune's setParams is queued for the NEXT render, so without the
    // pathResolves guard we'd fire one doomed getBuildingBooks(999)
    // before the URL gets rewritten.
    if (!treeLoaded || !pathOk) {
      setBooks([]);
      setBooksLoading(false);
      return;
    }
    setBooks([]);
    setBooksLoading(true);
    const fetch = shelfId    ? api.getShelfBooks(shelfId)
      : unitId              ? api.getUnitBooks(unitId)
      : roomId              ? api.getRoomBooks(roomId)
      : api.getBuildingBooks(buildingId);
    fetch
      .then(b => { if (gen === booksGenRef.current) setBooks(b); })
      .catch(() => { if (gen === booksGenRef.current) setError('Failed to load books at this location.'); })
      .finally(() => { if (gen === booksGenRef.current) setBooksLoading(false); });
  }, [buildingId, roomId, unitId, shelfId, treeLoaded, pathOk, refreshTick]);

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
    // Capture the location-load gen so the recovery refetch (and its error
    // setters) can be dropped if the user has navigated to a different
    // shelf/room/etc. by the time the reorder PUT resolves. Without this,
    // a stale `setBooks(...)` from the recovery would clobber the new
    // location's just-loaded books.
    const gen = booksGenRef.current;
    // Capture the reorder seq so an earlier failed PUT whose recovery
    // refetch lands after a later drag's optimistic apply doesn't snap
    // pre-A server state over B's newer order.
    const reorderSeq = ++reorderSeqRef.current;
    api.reorderShelf(shelfId, reordered.map(b => b.id))
      .catch(() => {
        if (gen !== booksGenRef.current || reorderSeq !== reorderSeqRef.current) return;
        // Always tell the user their reorder didn't save — even when the
        // recovery refetch succeeds and the canonical order snaps back into
        // place, otherwise the snap-back looks like the drag never
        // registered. If the refetch ALSO fails we upgrade the message so
        // the user knows to refresh manually.
        setError('Failed to save reorder.');
        api.getShelfBooks(shelfId)
          .then(b => { if (gen === booksGenRef.current && reorderSeq === reorderSeqRef.current) setBooks(b); })
          .catch(() => { if (gen === booksGenRef.current && reorderSeq === reorderSeqRef.current) setError('Reorder failed and could not be reverted — refresh the page.'); });
      });
  }

  const building = tree.find(b => b.id === buildingId);
  const rooms    = building?.rooms ?? [];
  const room     = rooms.find(r => r.id === roomId);
  const units    = room?.units ?? [];
  const unit     = units.find(u => u.id === unitId);
  const shelves  = unit?.shelves ?? [];
  const shelf    = shelves.find(s => s.id === shelfId);

  function nav(updates) {
    const next = {};
    if (updates.b != null) next.b = updates.b;
    if (updates.r != null) next.r = updates.r;
    if (updates.u != null) next.u = updates.u;
    if (updates.s != null) next.s = updates.s;
    setParams(next);
  }

  const crumbs = [
    { label: 'Shelves', action: () => setParams({}) },
    building && { label: building.name, action: () => nav({ b: buildingId }) },
    room     && { label: room.name,     action: () => nav({ b: buildingId, r: roomId }) },
    unit     && { label: unit.name,     action: () => nav({ b: buildingId, r: roomId, u: unitId }) },
    shelf    && { label: shelf.label, action: null },
  ].filter(Boolean);

  if (loading) return <div role="status" className="text-neutral-700 text-sm">Loading…</div>;

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center justify-between bg-warn/10 border border-warn/30 rounded px-3 py-2">
          <p role="alert" className="text-xs text-warn">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-warn/60 hover:text-warn ml-4">×</button>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <nav className="flex items-center gap-1.5 text-sm text-neutral-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-neutral-800">/</span>}
              {c.action ? (
                <button onClick={c.action} className="hover:text-neutral-200 transition-colors">
                  {c.label}
                </button>
              ) : (
                <span className="text-white font-medium">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <Link
          to="/shelf"
          className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
        >
          Manage shelves →
        </Link>
      </div>

      {/* Buildings */}
      {!buildingId && (
        tree.length === 0 ? (
          <div className="text-center py-32">
            <p className="text-neutral-600 mb-3">No shelves configured yet.</p>
            <Link to="/shelf" className="text-sm text-oak hover:text-leather">Manage shelves →</Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tree.map(b => (
                <LevelCard
                  key={b.id}
                  primary={b.name}
                  secondary={[PROXIMITY_LABEL[b.proximity], plural(b.rooms.length, 'room'), b.book_count > 0 && plural(b.book_count, 'book')].filter(Boolean).join(' · ')}
                  onClick={() => nav({ b: b.id })}
                />
              ))}
            </div>

            {unshelfedError && (
              // Scoped warning for an unshelfed-books fetch failure — sits
              // where the section would otherwise render, so the user
              // knows what specifically is missing without the page-wide
              // "Failed to load shelves" being implied.
              <p role="alert" className="mt-10 text-xs text-warn">{unshelfedError}</p>
            )}
            {unshelfed.length > 0 && (
              <div className="mt-10">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-4 pb-2 border-b border-neutral-800">
                  No location assigned · {unshelfed.length}
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5">
                  {unshelfed.map(book => (
                    <BookCard key={book.id} book={book} linkState={fromState} />
                  ))}
                </div>
              </div>
            )}
          </>
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
        ) : books.length > 0 && (
          <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5 ${rooms.length > 0 ? 'mt-8' : ''}`}>
            {books.map(book => <BookCard key={book.id} book={book} linkState={fromState} />)}
          </div>
        )}
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
        ) : books.length > 0 && (
          <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5 ${units.length > 0 ? 'mt-8' : ''}`}>
            {books.map(book => <BookCard key={book.id} book={book} linkState={fromState} />)}
          </div>
        )}
        {!booksLoading && units.length === 0 && books.length === 0 && (
          <p className="text-neutral-600 text-sm">No books in this room yet.</p>
        )}
      </>)}

      {/* Shelves rendered as stacked horizontal rows + unit-level (shelfless) books */}
      {unitId && !shelfId && (<>
        {booksLoading ? (
          <div role="status" className="text-neutral-700 text-sm">Loading…</div>
        ) : (<>
          {shelves.length > 0 && (
            <div className="-mx-4 sm:-mx-6 lg:-mx-8">
              {shelves.map(s => (
                <ShelfRow
                  key={s.id}
                  shelf={s}
                  books={books.filter(b => b.shelf_id === s.id)}
                  linkState={fromState}
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
                    const gen = booksGenRef.current;
                    const reorderSeq = ++reorderSeqRef.current;
                    api.reorderShelf(shelfId, reordered.map(b => b.id))
                      .catch(() => {
                        if (gen !== booksGenRef.current || reorderSeq !== reorderSeqRef.current) return;
                        setError('Failed to save reorder.');
                        api.getUnitBooks(unitId)
                          .then(b => { if (gen === booksGenRef.current && reorderSeq === reorderSeqRef.current) setBooks(b); })
                          .catch(() => { if (gen === booksGenRef.current && reorderSeq === reorderSeqRef.current) setError('Reorder failed and could not be reverted — refresh the page.'); });
                      });
                  }}
                />
              ))}
            </div>
          )}
          {(() => {
            const unitOnly = books.filter(b => !b.shelf_id);
            if (unitOnly.length === 0) return null;
            return (
              <div className={shelves.length > 0 ? 'mt-6 pt-6 border-t border-neutral-800/50' : ''}>
                {shelves.length > 0 && (
                  <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-4">Not on a shelf</h2>
                )}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5">
                  {unitOnly.map(book => <BookCard key={book.id} book={book} linkState={fromState} />)}
                </div>
              </div>
            );
          })()}
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
                  {books.map(book => <SortableShelfCover key={book.id} book={book} linkState={fromState} />)}
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
