import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import CompletionIndicator from '../components/CompletionIndicator.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useLatest } from '../hooks/useLatest.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';

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
function SortableBookCard({ book, onRemove, draggable, linkState }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  // Whole-cover drag: listeners attach to the wrapper div, not a small
  // handle button, so the user can grab anywhere on the cover. The
  // centered three-lines glyph stays as a purely decorative "this is
  // grabbable" cue — pointer-events:none keeps it from intercepting the
  // drag pointerdown. Remove × stays as a real button (top-right corner)
  // and gets pointer-events:auto so it remains clickable above the
  // wrapper-level listeners; PointerSensor activationConstraint keeps a
  // click on × from accidentally arming a drag.
  const overlay = (
    <>
      {draggable && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <div className="bg-black/75 backdrop-blur-sm rounded px-2 py-1 text-neutral-300">
            <DragHandle />
          </div>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onRemove(book.id); }}
          className="pointer-events-auto absolute top-1 right-1 bg-neutral-900/90 hover:bg-red-900 border border-neutral-700 rounded-full w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-white transition-colors text-base leading-none shadow-lg"
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
      {...(draggable ? listeners : {})}
      className={`group relative select-none transition-opacity ring-2 ring-binding/40 rounded-lg ${isDragging ? 'opacity-40' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <BookCard book={book} coverOverlay={overlay} hideActions fadeUnowned linkState={linkState} />
    </div>
  );
}

function QuickAdd({ listId, onAdded }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [expanded, setExpanded] = useState(false);
  const saveGuard = useActionGuard();
  const [error, setError] = useState(null);
  const titleRef = useRef(null);
  // Track the current listId so a submission whose awaits resolve after the
  // user has navigated to a different list can detect the change and skip
  // the parent callback. onAdded → handleAdded splices into the parent's
  // current `list` via functional setList, so without this guard a stale
  // resolution would graft List A's just-added book onto List B's display.
  // The form-state clears are gated too: they'd otherwise blank out fresh
  // text the user has started typing on List B's quick-add.
  const listIdRef = useLatest(listId);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    // Mirror the button's disabled predicate so an Enter-key submit while
    // a save is in flight can't race a duplicate createBook + addToList.
    // createBook with is_stub:true has no title-idempotency, so a
    // duplicate lands as a real second book row plus a second list entry.
    if (!saveGuard.begin()) return;
    const submittedListId = listId;
    setError(null);
    try {
      const book = await api.createBook({ title: title.trim(), authors: author.trim() ? [author.trim()] : [], is_stub: true });
      await api.addToList(submittedListId, book.id);
      if (listIdRef.current !== submittedListId) return;
      // Pass submittedListId so the parent can re-check on its side. If
      // the user navigated mid-flight, QuickAdd's `key={id}` unmount
      // killed this instance's `listIdRef` (always stuck at the old id
      // from this closure), so the check above only catches in-instance
      // navigation. The parent's check catches the unmount-and-remount
      // path where this .then still runs against the new list's state.
      onAdded(book, submittedListId);
      setTitle('');
      setAuthor('');
      setExpanded(false);
      titleRef.current?.focus();
    } catch (err) {
      if (listIdRef.current !== submittedListId) return;
      setError(err?.message || 'Failed to add book.');
    } finally {
      saveGuard.end();
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
        aria-label="Book title to add"
        className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors flex-1"
      />
      {expanded && (
        <input
          type="text"
          value={author}
          onChange={e => setAuthor(e.target.value)}
          placeholder="Author (optional)"
          aria-label="Book author (optional)"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 transition-colors w-48"
        />
      )}
      <button
        type="submit"
        disabled={saveGuard.busy || !title.trim()}
        className="text-sm font-medium bg-oak hover:bg-leather disabled:opacity-40 motion-safe:active:scale-[0.98] text-neutral-950 px-4 py-2 rounded-lg transition-[transform,background-color] ease-out duration-150 whitespace-nowrap"
      >
        Add
      </button>
      {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    </form>
  );
}

export default function ListDetail() {
  const { id } = useParams();
  const [list, setList] = useState(null);
  // Prefer the specific list name so the destination's back link reads
  // "← [list name]" (matching the rest of Spine's entity-aware back
  // labels). 'List' is the fallback for the brief window before the
  // fetch lands, though book cards aren't rendered until `loading`
  // flips false — so the fallback rarely fires in practice.
  const fromState = useMemo(
    () => ({ from: list?.name ?? 'List', fromPath: `/lists/${id}` }),
    [id, list?.name],
  );
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
  const guard = useStaleGuard();
  // Synchronous mirror of the loadingMore/loadingAll *pair*. The button
  // disabled props gate user clicks but the state setters don't commit
  // until next render — so two same-tick clicks (or Load more + Load all
  // together) all pass the `loadingMore || loadingAll` check, fire
  // duplicate getList calls at the same offset, and double-bump
  // loadedRef.current. Mirrors Library.pagingRef.
  const pagingRef = useRef(false);
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
  // Tracks the last id|sort the load effect ran for so refresh-tick
  // refetches at the same key don't flash the loading state or cancel an
  // in-progress rename. Mirrors Library.lastFetchKeyRef.
  const prevKeyRef = useRef('');
  const refreshTick = useRefreshTick();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag: Space on a focused draggable starts a drag, arrow keys
    // move, Enter drops, Escape cancels. WAI-ARIA pattern; runs alongside
    // PointerSensor without affecting mouse interaction.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggleEditMode() {
    if (!editMode && sort !== 'added') setSort('added');
    setEditMode(m => !m);
  }

  useEffect(() => {
    const epoch = guard.next();
    const key = `${id}|${sort}`;
    const isRealChange = prevKeyRef.current !== key;
    prevKeyRef.current = key;
    // Only show "Loading…" and cancel the rename UI on a real navigation
    // (id or sort change). A refresh-tick refetch at the same key keeps
    // the current view in place — atomic data swap via setList(data)
    // below — so the user doesn't see a flash and an in-progress rename
    // doesn't get yanked shut on alt-tab.
    if (isRealChange) {
      setLoading(true);
      setError(null);
      setRenaming(false);
      setRenameError(null);
      setRenameValue('');
    }
    // Action banner and pagination flags clear on every fire — they're
    // transient state that shouldn't persist across any refetch (the
    // guard.next() bump above also orphans in-flight loadMore/loadAll
    // whose finally clauses would otherwise strand the flags).
    setActionError(null);
    setLoadingMore(false);
    setLoadingAll(false);
    loadedRef.current = 0;
    const params = sort === 'added' ? { sort } : { sort, limit: PAGE_SIZE, offset: 0 };
    api.getList(id, params)
      .then(data => {
        if (!guard.isFresh(epoch)) return;
        setList(data);
        setTotal(data.total);
        loadedRef.current = data.books.length;
      })
      .catch(() => { if (guard.isFresh(epoch)) setError('Failed to load list.'); })
      .finally(() => { if (guard.isFresh(epoch)) setLoading(false); });
  }, [id, sort, refreshTick]);

  const loadMore = useCallback(async () => {
    if (pagingRef.current || loadingMore || loadingAll) return;
    const epoch = guard.current();
    pagingRef.current = true;
    setLoadingMore(true);
    setActionError(null);
    try {
      const data = await api.getList(id, { sort, limit: PAGE_SIZE, offset: loadedRef.current });
      if (!guard.isFresh(epoch)) return;
      setList(l => ({ ...l, books: [...l.books, ...data.books] }));
      loadedRef.current += data.books.length;
    } catch {
      if (guard.isFresh(epoch)) setActionError('Failed to load more books.');
    } finally {
      // Clear unconditionally — if epoch has bumped, the new load effect
      // already reset loadingMore via setState, so leaving the ref stuck
      // would block all future paging on the new list.
      pagingRef.current = false;
      if (guard.isFresh(epoch)) setLoadingMore(false);
    }
  }, [id, sort, loadingMore, loadingAll]);

  const loadAll = useCallback(async () => {
    if (pagingRef.current || loadingMore || loadingAll) return;
    const epoch = guard.current();
    pagingRef.current = true;
    setLoadingAll(true);
    setActionError(null);
    try {
      while (guard.isFresh(epoch) && loadedRef.current < total) {
        const data = await api.getList(id, { sort, limit: PAGE_SIZE, offset: loadedRef.current });
        if (!guard.isFresh(epoch)) break;
        setList(l => ({ ...l, books: [...l.books, ...data.books] }));
        loadedRef.current += data.books.length;
        if (data.books.length === 0) break;
      }
    } catch {
      if (guard.isFresh(epoch)) setActionError('Failed to load more books.');
    } finally {
      pagingRef.current = false;
      if (guard.isFresh(epoch)) setLoadingAll(false);
    }
  }, [id, sort, total, loadingMore, loadingAll]);

  function handleAdded(book, submittedListId) {
    // Guard against the QuickAdd-cross-navigation race: if the user
    // navigated to a different list between submit and resolve, the
    // book belongs on the submitted list (server-side it's there) but
    // shouldn't appear in the current list's local view. Without this
    // check, QuickAdd's `key={id}` unmount kills its instance-local
    // listIdRef check, and the .then still ends up here against the
    // new list's state.
    if (submittedListId != null && String(submittedListId) !== String(id)) return;
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
    // Capture epoch so a rename for list A whose PUT resolves after the
    // user has navigated to list B doesn't slam A's new name onto B's
    // display (or surface A's error on B's view).
    const epoch = guard.current();
    renamingInFlightRef.current = true;
    try {
      const updated = await api.renameList(id, name);
      if (!guard.isFresh(epoch)) return;
      setList(l => ({ ...l, name: updated.name }));
      setRenaming(false);
    } catch (err) {
      if (!guard.isFresh(epoch)) return;
      setRenameError(err?.message || 'Failed to rename list.');
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
    // Capture the load epoch so the rollback + error message are dropped
    // if the user has navigated to a different list by the time the
    // reorder PUT resolves. Without this, a failed PUT for list A would
    // apply a stale snapshot to list B's books and surface A's error on B.
    const epoch = guard.current();
    // Capture the reorder seq so an earlier failed PUT whose .catch lands
    // after a later drag's optimistic apply doesn't restore a now-stale
    // pre-A snapshot over B's newer order.
    const reorderSeq = ++reorderSeqRef.current;
    api.reorderList(id, reordered.map(b => b.id)).catch(() => {
      if (!guard.isFresh(epoch) || reorderSeq !== reorderSeqRef.current) return;
      setList(l => ({ ...l, books: previousBooks }));
      setActionError('Failed to save list order.');
    });
  }

  if (loading) return <div role="status" className="text-neutral-700 text-sm">Loading…</div>;
  if (error)   return <div role="alert" className="text-red-500 text-sm">{error}</div>;

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
              aria-label="List name"
              className="bg-neutral-800 border border-neutral-700 rounded px-3 py-1 text-lg font-bold text-white focus:outline-none focus:border-oak/50"
            />
            {renameError && <span role="alert" className="text-xs text-red-400">{renameError}</span>}
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
        <span className="text-xs text-neutral-600 mt-0.5">{plural(total, 'book')}</span>
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
              type="button"
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
          {actionError && <p role="alert" className="text-xs text-warn mb-2">{actionError}</p>}
          {editMode ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={list.books.map(b => b.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start">
                  {list.books.map(book => (
                    <SortableBookCard key={book.id} book={book} onRemove={handleRemove} draggable={draggable} linkState={fromState} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start">
              {list.books.map(book => (
                <BookCard key={book.id} book={book} fadeUnowned linkState={fromState} />
              ))}
            </div>
          )}
          {sort !== 'added' && list.books.length < total && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore || loadingAll}
                  className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingMore ? 'Loading…' : `Load more · ${total - list.books.length} remaining`}
                </button>
                <button
                  type="button"
                  onClick={loadAll}
                  disabled={loadingMore || loadingAll}
                  className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-40 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingAll ? `Loading all · ${list.books.length}/${total}` : 'Load all'}
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
