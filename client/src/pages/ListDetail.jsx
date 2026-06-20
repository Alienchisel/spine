import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { submitOnModEnter } from '../components/bookForm/styles.js';
import { primaryButton } from '../components/buttonStyles.js';
import { MOD_KEY, FORMAT_LABEL } from '../utils.js';
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
import { GridSkeleton } from '../components/Skeleton.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { usePaginatedFetch } from '../hooks/usePaginatedFetch.js';
import { useSpineEvent } from '../hooks/useSpineEvent.js';
import { useLatest } from '../hooks/useLatest.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';

const PAGE_SIZE = 48;

const SORTS = [
  { key: 'added',               label: 'Custom order' },
  { key: 'title',               label: 'Title A–Z' },
  { key: 'author',              label: 'Author A–Z' },
  { key: 'year_published',      label: 'Chronological' },
  { key: 'year_published_desc', label: 'Reverse chronological' },
  { key: 'rating',              label: 'Rating' },
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
          aria-label={`Remove ${book.title} from list`}
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

function QuickAdd({ listId, listBookIds, onAdded }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const saveGuard = useActionGuard();
  // Synchronous in-flight guard on row clicks. Without it, a fast double-
  // click on the same row would fire two addToList POSTs and (more
  // importantly) two onAdded calls — and the parent splices into l.books
  // optimistically, so the row would appear twice in the local view until
  // the next refetch.
  const pickGuard = useActionGuard();
  const searchGuard = useStaleGuard();
  const debounce = useRef(null);
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

  // Debounced library search. Mirrors LookupPanel's stale-guard pattern so
  // a slow response from an earlier keystroke can't repopulate the dropdown
  // after the user has typed past it.
  useEffect(() => {
    clearTimeout(debounce.current);
    const q = title.trim();
    if (!q) {
      searchGuard.next();
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const epoch = searchGuard.next();
    debounce.current = setTimeout(async () => {
      try {
        const { books } = await api.getBooks({ q, limit: 6 });
        if (!searchGuard.isFresh(epoch)) return;
        setMatches(books || []);
      } catch {
        if (!searchGuard.isFresh(epoch)) return;
        setMatches([]);
      } finally {
        // Spinner only flips off for the LATEST request (matches LookupPanel).
        if (searchGuard.isFresh(epoch)) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(debounce.current);
  }, [title]);

  async function pickExisting(book) {
    if (!pickGuard.begin()) return;
    const submittedListId = listId;
    setError(null);
    try {
      await api.addToList(submittedListId, book.id);
      if (listIdRef.current !== submittedListId) return;
      onAdded(book, submittedListId);
      setTitle('');
      setAuthor('');
      setMatches([]);
      setExpanded(false);
      titleRef.current?.focus();
    } catch (err) {
      if (listIdRef.current !== submittedListId) return;
      setError(err?.message || 'Failed to add book.');
    } finally {
      pickGuard.end();
    }
  }

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
      setMatches([]);
      setExpanded(false);
      titleRef.current?.focus();
    } catch (err) {
      if (listIdRef.current !== submittedListId) return;
      setError(err?.message || 'Failed to add book.');
    } finally {
      saveGuard.end();
    }
  }

  const busy = saveGuard.busy || pickGuard.busy;

  return (
    <div className="mb-6 relative">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder="Add a book — search by title…"
          aria-label="Book title to add"
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors flex-1"
        />
        {expanded && (
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            placeholder="Author (optional, only used for new stubs)"
            aria-label="Book author (optional, only used for new stubs)"
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors w-72"
          />
        )}
        <button
          type="submit"
          disabled={busy || !title.trim()}
          title="Create a wishlist stub with this title and add it to the list"
          className={`${primaryButton} whitespace-nowrap`}
        >
          + Stub
        </button>
        {error && <span role="alert" className="text-xs text-warn">{error}</span>}
      </form>

      {/* Existing-library matches. Click a row to add the actual library
          book to this list; "already added" rows are surfaced (not
          hidden) so the user understands the duplicate they'd otherwise
          try to stub. The "+ Stub" button stays available throughout for
          the no-match / wishlist case. */}
      {title.trim() && (matches.length > 0 || searching) && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1.5 bg-neutral-900 border border-neutral-800 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {searching && matches.length === 0 ? (
            <div className="px-3 py-3 text-xs text-neutral-500">Searching the library…</div>
          ) : (
            matches.map(b => {
              const alreadyIn = listBookIds.has(b.id);
              // /api/books list rows carry the authors array, not the
              // pre-joined authors_display string — that's only on the
              // single-book GET. Join inline so the dropdown labels
              // don't render blank for every match.
              const authorsLabel = (b.authors || []).map(a => a.name).join(', ');
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => !alreadyIn && pickExisting(b)}
                  disabled={busy || alreadyIn}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${alreadyIn ? 'cursor-default opacity-50' : 'hover:bg-neutral-800'} disabled:cursor-default`}
                >
                  <div className="w-8 h-12 flex-shrink-0 bg-neutral-800 rounded-sm overflow-hidden">
                    {b.cover_path && <img src={b.cover_path} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-parchment truncate">{b.title}</div>
                    {authorsLabel && <div className="text-xs text-neutral-500 truncate">{authorsLabel}</div>}
                  </div>
                  <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                    {alreadyIn ? 'Already in list' : '+ Add to list'}
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

export default function ListDetail() {
  const { id } = useParams();
  // cohort threads the current list's ordered {id, title} pairs into
  // BookDetail's navState so the destination can render a list-aware
  // prev/next nav strip instead of falling back to series-sibling order
  // (which is arbitrary when series_number is null on most books in the
  // series). The cohort respects the user's current sort + load-depth,
  // so what shows under "next" matches what's literally to the right in
  // the list grid right now. Passed forward unchanged on each prev/next
  // hop so the context persists across navigation chains.
  // cohortIds holds the FULL ordered {id, title} list at the current
  // sort, independent of the paginated visible-books fetch. The
  // visible-books slice tops out at PAGE_SIZE (=48) on non-'added'
  // sorts, so without a separate fetch the cohort that ships to
  // BookDetail's prev/next would truncate at item 48 — fine for short
  // lists, breaks navigation on anything longer. Falls back to the
  // visible-books shape until the cohort fetch lands so the cohort is
  // present from the first paint, just possibly short.
  const [cohort, setCohort] = useState([]);
  const [sort, setSort] = useState('added');
  // Format chip — single-value, local state. Hidden in edit mode (drag
  // positions are absolute over the unfiltered list; reordering inside
  // a filtered subset would scramble positions of the hidden items).
  // Reset on list-id change so the filter doesn't leak between lists.
  const [formatFilter, setFormatFilter] = useState(null);
  useEffect(() => { setFormatFilter(null); }, [id]);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  // Description edit state mirrors the rename pattern — separate from
  // rename so a failed save on one doesn't clear the other's banner, and
  // both can be reset together on a real navigation (see isRealChange).
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState('');
  const [descError, setDescError] = useState(null);
  // Edit mode toggles drag handles + remove buttons on each card. When off,
  // the list renders identical BookCards to Library/Browse — no drag, no
  // remove, just covers and their normal per-card buttons (loved, readlist,
  // list-picker, progress editor). Drag-to-reorder requires sort='added'
  // (custom order); entering edit mode in any other sort coerces back.
  const [editMode, setEditMode] = useState(false);
  // useStaleGuard kept for the action handlers (rename, description save,
  // drag reorder) that each capture an epoch at handler start and check
  // freshness on response. The hook handles its own internal guard for
  // paging.
  const guard = useStaleGuard();
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
  // Per-list "default sort memory" sync. After the first GET of a list,
  // if the server-stored `default_sort` differs from our current sort
  // state, we setSort to it (triggers refetch with the correct sort).
  // Resets on id change so each list visit re-syncs. The ref distinguishes
  // user-driven sort changes (don't re-sync, the user just chose) from
  // the initial server-default adoption (sync once).
  const userChangedSortRef = useRef(false);
  // Synchronous in-flight guard for the rename PUT. The form has both
  // onSubmit={handleRename} and onBlur={handleRename}; the early-return on
  // `name === list.name` only protects after the rename has *committed*
  // (which doesn't happen until after the await). If the user presses
  // Enter and then clicks outside before the PUT resolves, blur fires a
  // second handleRename whose `renameValue === name` check still passes
  // (list.name is still the old name), and a duplicate PUT lands.
  const renamingInFlightRef = useRef(false);
  // Same in-flight guard rationale as renamingInFlightRef — the textarea
  // has both onSubmit (Ctrl/Cmd+Enter via submitOnModEnter) and onBlur
  // handlers, and a blur immediately after a submit could fire a second
  // PUT before the first resolves.
  const descInFlightRef = useRef(false);
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
    // Drag-to-reorder operates on positions across the full list; entering
    // edit mode with a format filter active would let drags scramble the
    // positions of the hidden books, so clear the filter on the way in.
    if (!editMode && formatFilter)    setFormatFilter(null);
    setEditMode(m => !m);
  }

  // Reset the auto-sync-default-sort guard on every list navigation.
  // Without this, navigating from list A (where the user changed sort,
  // setting the ref to true) to list B would prevent B's default_sort
  // from being adopted on first load.
  useEffect(() => {
    userChangedSortRef.current = false;
  }, [id]);

  // Paginated visible-books fetch. The list metadata (name, description,
  // owned_count, finished_count, default_sort) comes back in meta and
  // merges across pages within the same key. sort==='added' returns the
  // whole list unpaginated; the hook's loop sees items.length >= total
  // on first response and stops naturally, so Load more is hidden via
  // hasMore=false.
  const {
    items: books, setItems: setBooks,
    total, setTotal,
    meta, setMeta,
    loading: fetchLoading,
    loadingMore, loadingAll,
    hasMore, loadedCount, setLoadedCount,
    error,
    setError,
    actionError, setActionError,
    loadMore, loadAll,
  } = usePaginatedFetch(
    (offset, limit) => {
      const base = sort === 'added' ? { sort } : { sort, limit, offset };
      const params = formatFilter ? { ...base, formats: formatFilter } : base;
      return api.getList(id, params).then(({ books: bs, total: t, ...rest }) => ({
        items: bs, total: t, ...rest,
      }));
    },
    [id, sort, formatFilter],
    {
      key: `${id}|${sort}|${formatFilter ?? ''}`,
      pageSize: PAGE_SIZE,
    },
  );

  // Default-sort adoption — same shape as Author.jsx. When the server's
  // saved default_sort differs from current sort and the user hasn't
  // explicitly chosen yet, setSort triggers a refetch with the canonical
  // sort. Composite loading keeps the skeleton visible across the
  // adoption gap so the wrong-sort response never paints.
  const adopting = !!(
    meta.default_sort &&
    meta.default_sort !== sort &&
    !userChangedSortRef.current
  );
  useEffect(() => {
    if (adopting) setSort(meta.default_sort);
  }, [adopting, meta.default_sort]);
  const loading = fetchLoading || adopting;

  // Derive list from the hook's split state. The rest of the file reads
  // list.name / list.books / list.description / list.owned_count etc.
  // null while loading or adopting matches the original behaviour: the
  // skeleton-return at the render head fires first, downstream code
  // never sees a half-populated list.
  const list = (loading || meta.name === undefined) ? null : { ...meta, books, total };

  // Refetch-and-swap on book mutations from other surfaces. Without this
  // a location change via MoreMenu's Location picker would leave the
  // card's book prop stale — the "Currently on" header in the picker
  // would show the pre-mutation placement. Mirrors Library / BrowsePage.
  useSpineEvent('spine:book-mutated', (e) => {
    const id = Number(e.detail?.id);
    if (!id) return;
    api.getBook(id)
      .then(updated => {
        setBooks(prev => prev.map(b => b.id === id ? updated : b));
      })
      .catch(() => {});
  });
  // Local-remove-on-delete. Counts on the header derive from meta —
  // refetch the full list metadata if the deleted book skews owned/
  // finished percentages; otherwise just filter and decrement.
  useSpineEvent('spine:book-deleted', (e) => {
    const id = Number(e.detail?.id);
    if (!id) return;
    setBooks(prev => prev.filter(b => b.id !== id));
    setTotal(prev => Math.max(0, prev - 1));
    setLoadedCount(n => Math.max(0, n - 1));
  });

  // Reset rename / description editor UI on real navigation. Originally
  // lived in the load effect's isRealChange block; moved out so the hook
  // owns the fetch and these stay focused on UI cleanup.
  useEffect(() => {
    setRenaming(false);
    setRenameError(null);
    setRenameValue('');
    setEditingDesc(false);
    setDescError(null);
    setDescValue('');
  }, [id, sort]);

  // fromState + listBookIds need the derived list and the cohort fetch.
  // Co-located here so changes to either source flow through cleanly.
  const fromState = useMemo(
    () => ({
      from: meta.name ?? 'List',
      fromPath: `/lists/${id}`,
      cohort: cohort.length > 0
        ? cohort
        : books.map(b => ({ id: b.id, title: b.title })),
    }),
    [id, meta.name, books, cohort],
  );
  // ID set of books already on this list — flows into QuickAdd so the
  // existing-library matches dropdown can mark duplicates instead of
  // letting the user click a row that the server would silently
  // INSERT OR IGNORE. Sourced from the cohort fetch when available
  // (full list up to its cap) so the dedup signal is accurate beyond
  // the visible page; falls back to the visible-books shape during the
  // brief window before the cohort lands.
  const listBookIds = useMemo(() => {
    const src = cohort.length > 0 ? cohort : books;
    return new Set(src.map(b => b.id));
  }, [cohort, books]);

  // Full-cohort fetch — independent of the paginated visible-books fetch.
  // limit=500 is the server's cap; for lists larger than that, prev/next
  // truncates at the cap (acceptable tradeoff vs streaming or a separate
  // ids-only endpoint). Cleared on id/sort change so the previous list's
  // cohort doesn't leak into the new view's first paint. Deliberately
  // unfiltered (no `formats` param) — drives the format-chip availability
  // detection, so it needs the full distinct-format set of the list.
  useEffect(() => {
    setCohort([]);
    let cancelled = false;
    api.getList(id, { sort, limit: 500 })
      .then(data => {
        if (cancelled) return;
        setCohort((data.books || []).map(b => ({ id: b.id, title: b.title, format: b.format })));
      })
      .catch(() => { /* fall back to the visible-books cohort */ });
    return () => { cancelled = true; };
  }, [id, sort, refreshTick]);

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
    setBooks(prev => [{ ...book, added_at: new Date().toLocaleString('sv-SE') }, ...prev]);
    setMeta(m => ({
      ...m,
      owned_count:    (m.owned_count    ?? 0) + ownedDelta,
      finished_count: (m.finished_count ?? 0) + finishedDelta,
    }));
    setTotal(t => t + 1);
    setLoadedCount(n => n + 1);
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
      setBooks(prev => prev.filter(b => b.id !== bookId));
      setMeta(m => ({
        ...m,
        owned_count:    Math.max(0, (m.owned_count    ?? 0) - ownedDelta),
        finished_count: Math.max(0, (m.finished_count ?? 0) - finishedDelta),
      }));
      // Defensive clamps: a duplicate remove or a state desync would
      // otherwise let total / loadedCount go negative, which feeds a bad
      // offset into the next paginated getList and yields nonsense
      // percentages on the header counters.
      setTotal(t => Math.max(0, t - 1));
      setLoadedCount(n => Math.max(0, n - 1));
    } catch {
      // actionError, not error: this fails inline with the list intact.
      // The page-replacing `error` is reserved for load failures where
      // there's no list to render anyway.
      setActionError('Failed to remove book from list.');
    } finally {
      removingIdsRef.current.delete(bookId);
    }
  }

  async function handleDescriptionSave(e) {
    e?.preventDefault?.();
    if (descInFlightRef.current) return;
    const description = descValue.trim();
    const current = list.description ?? '';
    if (description === current) { setEditingDesc(false); return; }
    setDescError(null);
    const epoch = guard.current();
    descInFlightRef.current = true;
    try {
      const updated = await api.updateList(id, { description });
      if (!guard.isFresh(epoch)) return;
      setMeta(m => ({ ...m, description: updated.description }));
      setEditingDesc(false);
    } catch (err) {
      if (!guard.isFresh(epoch)) return;
      setDescError(err?.message || 'Failed to save description.');
    } finally {
      descInFlightRef.current = false;
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
      const updated = await api.updateList(id, { name });
      if (!guard.isFresh(epoch)) return;
      setMeta(m => ({ ...m, name: updated.name }));
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
    setBooks(reordered);
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
      setBooks(previousBooks);
      setActionError('Failed to save list order.');
    });
  }

  if (loading) return <GridSkeleton count={18} gridClassName="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start" />;
  if (error)   return <div role="alert" className="text-warn text-sm">Failed to load list.</div>;
  // Defensive: cover any future code path that lands here with list still
  // null (the in-effect adoption flag should prevent this, but the render
  // sites below dereference list.name / list.books / list.description
  // directly — a null slip would crash the whole page).
  if (!list)   return <GridSkeleton count={18} gridClassName="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start" />;

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
              className="bg-neutral-800 border border-neutral-700 rounded px-3 py-1 text-lg font-bold text-white focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors"
            />
            {renameError && <span role="alert" className="text-xs text-warn">{renameError}</span>}
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

      {/* Description: italic-muted prose explaining the list's purpose. Click
          to edit; Ctrl/Cmd+Enter or blur to save; Esc cancels. When absent,
          a faint "+ Add a description" affordance takes its place. */}
      {editingDesc ? (
        <form onSubmit={handleDescriptionSave} className="mb-6 max-w-2xl">
          <textarea
            autoFocus
            value={descValue}
            onChange={e => setDescValue(e.target.value)}
            onBlur={handleDescriptionSave}
            onKeyDown={e => {
              if (e.key === 'Escape') { setEditingDesc(false); setDescError(null); }
              submitOnModEnter(e);
            }}
            placeholder="What's this list for? (Markdown supported)"
            rows={3}
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors"
          />
          {descError && <p role="alert" className="text-xs text-warn mt-1">{descError}</p>}
          <p className="text-[11px] text-neutral-600 mt-1">{MOD_KEY}+Enter to save · Esc to cancel</p>
        </form>
      ) : list.description ? (
        <div
          className="mb-6 max-w-2xl text-sm italic text-neutral-400 hover:text-neutral-300 cursor-pointer transition-colors prose prose-invert prose-sm prose-p:my-2 prose-headings:my-2"
          title="Click to edit"
          onClick={() => { setDescError(null); setDescValue(list.description || ''); setEditingDesc(true); }}
        >
          <ReactMarkdown>{list.description}</ReactMarkdown>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setDescError(null); setDescValue(''); setEditingDesc(true); }}
          className="mb-6 text-xs text-neutral-600 hover:text-neutral-400 transition-colors focus:outline-none focus-visible:underline underline-offset-2"
        >
          + Add a description
        </button>
      )}

      {total > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-6 max-w-md">
          <CompletionIndicator label="Owned"  count={list.owned_count    ?? 0} total={total} />
          <CompletionIndicator label="Read"   count={list.finished_count ?? 0} total={total} />
        </div>
      )}

      {/* key={id} forces a fresh QuickAdd on every list switch so any
          half-typed title/author, the expanded state, and any error
          message don't leak from list A's view onto list B's view. */}
      <QuickAdd key={id} listId={id} listBookIds={listBookIds} onAdded={handleAdded} />

      {total === 0 ? (
        formatFilter ? (
          <div className="text-center py-24">
            <p className="text-neutral-600">
              No {FORMAT_LABEL[formatFilter]?.toLowerCase() ?? formatFilter} books in this list.
            </p>
            <button
              type="button"
              onClick={() => setFormatFilter(null)}
              className="mt-3 text-sm text-oak hover:text-leather transition-colors"
            >
              Show all formats →
            </button>
          </div>
        ) : (
          <div className="text-center py-24">
            <p className="text-neutral-600">This list is empty. Add a book above.</p>
          </div>
        )
      ) : (
        <>
          {(() => {
            const availableFormats = Array.from(new Set(
              (cohort.length > 0 ? cohort : books).map(b => b.format).filter(Boolean)
            )).sort();
            if (editMode || availableFormats.length <= 1) return null;
            return (
              <div className="mb-3 flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFormatFilter(null)}
                  aria-pressed={formatFilter == null}
                  className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                    formatFilter == null
                      ? 'bg-binding/50 text-parchment border-binding/70'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                  }`}
                >
                  All formats
                </button>
                {availableFormats.map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormatFilter(formatFilter === f ? null : f)}
                    aria-pressed={formatFilter === f}
                    className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                      formatFilter === f
                        ? 'bg-binding/50 text-parchment border-binding/70'
                        : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {FORMAT_LABEL[f] ?? f}
                  </button>
                ))}
              </div>
            );
          })()}
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
              onChange={e => {
                const newSort = e.target.value;
                userChangedSortRef.current = true;
                setSort(newSort);
                // Persist the choice as the list's new default_sort so the
                // next visit lands on the same sort. Fire-and-forget — a
                // failed PATCH only costs us memory across sessions; the
                // sort still works for this one.
                api.updateList(id, { default_sort: newSort }).catch(() => {});
              }}
              disabled={editMode}
              title={editMode ? 'Sorting is locked to Custom order while editing' : ''}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors disabled:opacity-60"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          {actionError && <p role="alert" className="text-xs text-warn mb-2">{typeof actionError === 'string' ? actionError : 'Failed to load more books.'}</p>}
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
                  className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-60 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingMore ? 'Loading…' : `Load more · ${total - loadedCount} remaining`}
                </button>
                <button
                  type="button"
                  onClick={loadAll}
                  disabled={loadingMore || loadingAll}
                  className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-60 transition-colors px-6 py-2 border border-neutral-800 rounded-lg"
                >
                  {loadingAll ? `Loading all · ${loadedCount}/${total}` : 'Load all'}
                </button>
              </div>
              {actionError && <p role="alert" className="text-xs text-warn">{typeof actionError === 'string' ? actionError : 'Failed to load more books.'}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
