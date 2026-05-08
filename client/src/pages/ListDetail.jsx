import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import CompletionIndicator from '../components/CompletionIndicator.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

const PAGE_SIZE = 48;

const SORTS = [
  { key: 'added',  label: 'Custom order' },
  { key: 'title',  label: 'Title A–Z' },
  { key: 'author', label: 'Author A–Z' },
  { key: 'rating', label: 'Rating' },
];

function DragHandle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
    </svg>
  );
}

// Edit-mode wrapper around the standard BookCard. Adds drag-to-reorder and
// remove-from-list affordances as overlays without touching BookCard, so
// outside edit mode the list page renders identically to Library and Browse
// — same covers, same per-card buttons, same hover behaviour. The drag
// listeners live on the handle button (not the wrapper), so a click on the
// cover still routes to BookDetail without arming a drag.
function SortableBookCard({ book, onRemove, draggable }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  // Drag handle and remove × are passed into BookCard's `coverOverlay` so
  // they anchor inside the cover frame (which is the right reference for
  // bottom/top positioning) rather than the outer wrapper, which extends
  // past the cover to include the title/author block. The drag-handle
  // button calls preventDefault so a plain click doesn't navigate to the
  // detail page via BookCard's enclosing Link; a real drag is suppressed
  // by dnd-kit before click fires anyway.
  const overlay = (
    <>
      {draggable && (
        <button
          {...listeners}
          onClick={(e) => e.preventDefault()}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/75 backdrop-blur-sm rounded px-2 py-1 text-neutral-300 hover:text-white transition-colors cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <DragHandle />
        </button>
      )}
      {onRemove && (
        <button
          onClick={(e) => { e.preventDefault(); onRemove(book.id); }}
          className="absolute top-1 right-1 bg-neutral-900/90 hover:bg-red-900 border border-neutral-700 rounded-full w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-white transition-colors text-base leading-none shadow-lg"
          title="Remove from list"
        >
          ×
        </button>
      )}
    </>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`relative select-none transition-opacity ring-2 ring-binding/40 rounded-lg ${isDragging ? 'opacity-40' : ''}`}
    >
      <BookCard book={book} coverOverlay={overlay} hideActions />
    </div>
  );
}

function QuickAdd({ listId, onAdded }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);
  // Track the current listId so a submission whose awaits resolve after the
  // user has navigated to a different list can detect the change and skip
  // the parent callback. onAdded → handleAdded splices into the parent's
  // current `list` via functional setList, so without this guard a stale
  // resolution would graft List A's just-added book onto List B's display.
  // The form-state clears are gated too: they'd otherwise blank out fresh
  // text the user has started typing on List B's quick-add.
  const listIdRef = useRef(listId);
  useEffect(() => { listIdRef.current = listId; }, [listId]);
  // Synchronous mirror of `saving` — `saving` (state) doesn't commit until
  // the next render, so two same-tick Enter submits both see saving === false
  // and fire duplicate createBook + addToList calls. createBook with
  // is_stub:true has no title-idempotency, so a duplicate lands as a real
  // second book row plus a second list entry. Mirrors the savingRef in
  // ReadsSection / BookCard / BookForm.
  const savingRef = useRef(false);

  async function handleSubmit(e) {
    e.preventDefault();
    // Mirror the button's disabled predicate so an Enter-key submit while a
    // save is in flight can't race a duplicate createBook + addToList.
    if (savingRef.current || saving || !title.trim()) return;
    const submittedListId = listId;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const book = await api.createBook({ title: title.trim(), authors: author.trim() ? [author.trim()] : [], is_stub: true });
      await api.addToList(submittedListId, book.id);
      if (listIdRef.current !== submittedListId) return;
      onAdded(book);
      setTitle('');
      setAuthor('');
      setExpanded(false);
      titleRef.current?.focus();
    } catch (err) {
      if (listIdRef.current !== submittedListId) return;
      setError(err.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 mb-6">
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onFocus={() => setExpanded(true)}
        placeholder="Quick-add a book by title…"
        className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors flex-1"
      />
      {expanded && (
        <input
          type="text"
          value={author}
          onChange={e => setAuthor(e.target.value)}
          placeholder="Author (optional)"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors w-48"
        />
      )}
      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="text-sm font-medium bg-oak hover:bg-leather disabled:opacity-40 active:scale-[0.98] text-neutral-950 px-4 py-2 rounded-lg transition-[transform,background-color] ease-out duration-150 whitespace-nowrap"
      >
        Add
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  );
}

export default function ListDetail() {
  const { id } = useParams();
  const [list, setList] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState(null);
  // Distinct from `error`, which fully replaces the page on load failure
  // (line ~294). Transient mutation/pagination failures (reorder, Load
  // more, Show all) leave the list intact, so this surfaces inline —
  // both above the books and next to the Load more buttons so it's
  // visible wherever the user's eye happens to be.
  const [actionError, setActionError] = useState(null);
  const [sort, setSort] = useState('added');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  // Edit mode toggles drag handles + remove buttons on each card. When off,
  // the list renders identical BookCards to Library/Browse — no drag, no
  // remove, just covers and their normal per-card buttons (loved, readlist,
  // list-picker, progress editor). Drag-to-reorder requires sort='added'
  // (custom order); entering edit mode in any other sort coerces back.
  const [editMode, setEditMode] = useState(false);
  const loadedRef = useRef(0);
  const genRef = useRef(0);
  // Bumped on every drag so an earlier failed reorder whose .catch lands
  // *after* a later drag has already applied optimistically can detect
  // that it's stale — without this, A's rollback to its pre-A snapshot
  // would clobber B's newer optimistic order.
  const reorderSeqRef = useRef(0);
  // Tracks book ids whose remove call is still in flight. Prevents a fast
  // double-click from firing a second api.removeFromList before the first
  // resolves — that's the only window where local state still contains
  // the book, so the in-state guard inside handleRemove can't catch it.
  const removingIdsRef = useRef(new Set());
  // Synchronous in-flight guard for the rename PUT. The form has both
  // onSubmit={handleRename} and onBlur={handleRename}; the early-return on
  // `name === list.name` only protects after the rename has *committed*
  // (which doesn't happen until after the await). If the user presses
  // Enter and then clicks outside before the PUT resolves, blur fires a
  // second handleRename whose `renameValue === name` check still passes
  // (list.name is still the old name), and a duplicate PUT lands.
  const renamingInFlightRef = useRef(false);
  const refreshTick = useRefreshTick();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function toggleEditMode() {
    if (!editMode && sort !== 'added') setSort('added');
    setEditMode(m => !m);
  }

  useEffect(() => {
    let stale = false;
    genRef.current += 1;
    setLoading(true);
    setError(null);
    // Drop any lingering action banner (load-more / reorder / remove
    // failures) at the start of a fresh load so a refresh-tick reload
    // doesn't leave a stale "Failed to …" sitting above an updated list.
    // Start-clear (vs success-clear) closes the race where a quick user
    // action fires between effect-start and effect-success — its fresh
    // actionError is preserved instead of getting wiped by the .then.
    setActionError(null);
    // The genRef bump above orphans any in-flight loadMore/loadAll: their
    // finally clauses are gated on `gen === genRef.current` and will skip
    // setLoadingMore(false)/setLoadingAll(false), leaving the pagination
    // buttons disabled forever. Clear the flags here so a refresh-tick or
    // sort change can't strand them.
    setLoadingMore(false);
    setLoadingAll(false);
    // Also drop any open rename UI: navigating between lists while the
    // rename input is open would otherwise leave the form rendered on the
    // new list with the previous list's value (and any error message) still
    // visible. The handleRename gen-guard handles the in-flight PUT response
    // separately.
    setRenaming(false);
    setRenameError(null);
    setRenameValue('');
    loadedRef.current = 0;
    const params = sort === 'added' ? { sort } : { sort, limit: PAGE_SIZE, offset: 0 };
    api.getList(id, params)
      .then(data => {
        if (stale) return;
        setList(data);
        setTotal(data.total);
        loadedRef.current = data.books.length;
      })
      .catch(() => { if (!stale) setError('Failed to load list.'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [id, sort, refreshTick]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loadingAll) return;
    const gen = genRef.current;
    setLoadingMore(true);
    setActionError(null);
    try {
      const data = await api.getList(id, { sort, limit: PAGE_SIZE, offset: loadedRef.current });
      if (gen !== genRef.current) return;
      setList(l => ({ ...l, books: [...l.books, ...data.books] }));
      loadedRef.current += data.books.length;
    } catch {
      if (gen === genRef.current) setActionError('Failed to load more books.');
    } finally {
      if (gen === genRef.current) setLoadingMore(false);
    }
  }, [id, sort, loadingMore, loadingAll]);

  const loadAll = useCallback(async () => {
    if (loadingMore || loadingAll) return;
    const gen = genRef.current;
    setLoadingAll(true);
    setActionError(null);
    try {
      while (gen === genRef.current && loadedRef.current < total) {
        const data = await api.getList(id, { sort, limit: PAGE_SIZE, offset: loadedRef.current });
        if (gen !== genRef.current) break;
        setList(l => ({ ...l, books: [...l.books, ...data.books] }));
        loadedRef.current += data.books.length;
        if (data.books.length === 0) break;
      }
    } catch {
      if (gen === genRef.current) setActionError('Failed to load more books.');
    } finally {
      if (gen === genRef.current) setLoadingAll(false);
    }
  }, [id, sort, total, loadingMore, loadingAll]);

  function handleAdded(book) {
    // Mirror handleRemove's counter handling: today QuickAdd always
    // creates a stub with owned=0 / status='unread' so both deltas resolve
    // to 0, but if the create defaults ever shift (or QuickAdd grows an
    // owned toggle) we'd silently leave the header percentages stale.
    // Cheap insurance against a future regression.
    const ownedDelta    = book.owned                 ? 1 : 0;
    const finishedDelta = book.status === 'finished' ? 1 : 0;
    setList(l => ({
      ...l,
      books: [{ ...book, added_at: new Date().toLocaleString('sv-SE') }, ...l.books],
      owned_count:    (l.owned_count    ?? 0) + ownedDelta,
      finished_count: (l.finished_count ?? 0) + finishedDelta,
    }));
    setTotal(t => t + 1);
    loadedRef.current += 1;
  }

  async function handleRemove(bookId) {
    // Drop a duplicate remove while the first one is still in flight —
    // local state hasn't filtered the book out yet (that happens after
    // the await), so the in-state guard below can't see the duplicate.
    if (removingIdsRef.current.has(bookId)) return;
    const removed = list.books.find(b => b.id === bookId);
    // Bail if the book is no longer in local state — a stale event that
    // fired after a previous remove already filtered it out would
    // otherwise hit the API for a book that's gone, and decrement
    // total/loadedRef even though there's nothing to decrement.
    if (!removed) return;
    removingIdsRef.current.add(bookId);
    setActionError(null);
    // Capture the book's owned/finished state before removing so the
    // completion indicators on the page header don't go stale. Only `total`
    // was being decremented before; the percentages would keep showing the
    // pre-remove ratio until a full refetch.
    const ownedDelta    = removed.owned                  ? 1 : 0;
    const finishedDelta = removed.status === 'finished'  ? 1 : 0;
    try {
      await api.removeFromList(id, bookId);
      setList(l => ({
        ...l,
        books:          l.books.filter(b => b.id !== bookId),
        owned_count:    Math.max(0, (l.owned_count    ?? 0) - ownedDelta),
        finished_count: Math.max(0, (l.finished_count ?? 0) - finishedDelta),
      }));
      // Defensive clamps: a duplicate remove or a state desync would
       // otherwise let total / loadedRef go negative, which feeds a bad
       // offset into the next paginated getList and yields nonsense
       // percentages on the header counters.
      setTotal(t => Math.max(0, t - 1));
      loadedRef.current = Math.max(0, loadedRef.current - 1);
    } catch {
      // actionError, not error: this fails inline with the list intact.
      // The page-replacing `error` is reserved for load failures where
      // there's no list to render anyway.
      setActionError('Failed to remove book from list.');
    } finally {
      removingIdsRef.current.delete(bookId);
    }
  }

  async function handleRename(e) {
    e.preventDefault();
    if (renamingInFlightRef.current) return;
    const name = renameValue.trim();
    if (!name || name === list.name) { setRenaming(false); return; }
    setRenameError(null);
    // Capture gen so a rename for list A whose PUT resolves after the user
    // has navigated to list B doesn't slam A's new name onto B's display
    // (or surface A's error on B's view).
    const gen = genRef.current;
    renamingInFlightRef.current = true;
    try {
      const updated = await api.renameList(id, name);
      if (gen !== genRef.current) return;
      setList(l => ({ ...l, name: updated.name }));
      setRenaming(false);
    } catch (err) {
      if (gen !== genRef.current) return;
      setRenameError(err.message);
    } finally {
      renamingInFlightRef.current = false;
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = list.books.findIndex(b => b.id === active.id);
    const newIndex = list.books.findIndex(b => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    // Snapshot the pre-move array so a failed PUT restores known-good state.
    // The previous invert-move (arrayMove(l.books, newIndex, oldIndex)) only
    // produced the right result if l.books still equalled the post-move state
    // — any intervening mutation (a second drag, a remove) would scramble the
    // order on rollback.
    const previousBooks = list.books;
    const reordered = arrayMove(previousBooks, oldIndex, newIndex);
    setActionError(null);
    setList(l => ({ ...l, books: reordered }));
    // Capture the load gen so the rollback + error message are dropped if
    // the user has navigated to a different list by the time the reorder
    // PUT resolves. Without this, a failed PUT for list A would apply a
    // stale snapshot to list B's books and surface A's error on B.
    const gen = genRef.current;
    // Capture the reorder seq so an earlier failed PUT whose .catch lands
    // after a later drag's optimistic apply doesn't restore a now-stale
    // pre-A snapshot over B's newer order.
    const reorderSeq = ++reorderSeqRef.current;
    api.reorderList(id, reordered.map(b => b.id)).catch(() => {
      if (gen !== genRef.current || reorderSeq !== reorderSeqRef.current) return;
      setList(l => ({ ...l, books: previousBooks }));
      setActionError('Failed to save list order.');
    });
  }

  if (loading) return <div className="text-neutral-700 text-sm">Loading…</div>;
  if (error)   return <div className="text-red-500 text-sm">{error}</div>;

  const draggable = sort === 'added';

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/lists" className="text-neutral-600 hover:text-neutral-400 transition-colors text-sm">
          ← Lists
        </Link>
        <span className="text-neutral-700">/</span>
        {renaming ? (
          <form onSubmit={handleRename} className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onBlur={handleRename}
              className="bg-neutral-800 border border-neutral-700 rounded px-3 py-1 text-lg font-bold text-white focus:outline-none focus:border-oak/50"
            />
            {renameError && <span className="text-xs text-red-400">{renameError}</span>}
          </form>
        ) : (
          <h1
            className="text-xl font-bold text-white cursor-pointer hover:text-neutral-300 transition-colors"
            title="Click to rename"
            onClick={() => { setRenameError(null); setRenameValue(list.name); setRenaming(true); }}
          >
            {list.name}
          </h1>
        )}
        <span className="text-xs text-neutral-600 mt-0.5">{total} {total === 1 ? 'book' : 'books'}</span>
      </div>

      {total > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6 max-w-md">
          <CompletionIndicator label="Owned"  count={list.owned_count    ?? 0} total={total} />
          <CompletionIndicator label="Read"   count={list.finished_count ?? 0} total={total} />
        </div>
      )}

      {/* key={id} forces a fresh QuickAdd on every list switch so any
          half-typed title/author, the expanded state, and any error
          message don't leak from list A's view onto list B's view. */}
      <QuickAdd key={id} listId={id} onAdded={handleAdded} />

      {total === 0 ? (
        <div className="text-center py-24">
          <p className="text-neutral-600">This list is empty. Add a book above.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-3">
            <button
              onClick={toggleEditMode}
              className={`text-sm px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                editMode
                  ? 'bg-binding/25 text-parchment'
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {editMode ? 'Done' : 'Edit'}
            </button>
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              disabled={editMode}
              title={editMode ? 'Sorting is locked to Custom order while editing' : ''}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 transition-colors disabled:opacity-50"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          {actionError && <p className="text-xs text-warn mb-2">{actionError}</p>}
          {editMode ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={list.books.map(b => b.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start">
                  {list.books.map(book => (
                    <SortableBookCard key={book.id} book={book} onRemove={handleRemove} draggable={draggable} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start">
              {list.books.map(book => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          )}
          {sort !== 'added' && list.books.length < total && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <div className="flex justify-center gap-3">
                <button
                  onClick={loadMore}
                  disabled={loadingMore || loadingAll}
                  className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingMore ? 'Loading…' : `Load more · ${total - list.books.length} remaining`}
                </button>
                <button
                  onClick={loadAll}
                  disabled={loadingMore || loadingAll}
                  className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingAll ? `Loading all · ${list.books.length}/${total}` : 'Load all'}
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
