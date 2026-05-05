import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatAuthors } from '../utils.js';
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
import CompletionIndicator from '../components/CompletionIndicator.jsx';

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

function Stars({ rating }) {
  if (!rating) return null;
  const full = Math.floor(rating);
  const half = rating % 1 !== 0;
  return (
    <span className="text-xs text-oak tracking-tight flex-shrink-0">
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
    </span>
  );
}

function SortableListCard({ book, onRemove, draggable }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  // Audiobook covers are square; everything else uses 2:3 like the rest of
  // the app. Stub books still get the letter-and-title placeholder so the
  // grid stays even when the cover is missing.
  const coverAspect = book.format === 'audiobook' ? 'aspect-square' : 'aspect-[2/3]';
  const titleInitial = (book.title.replace(/^(the|a|an)\s+/i, '') || book.title)[0].toUpperCase();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`select-none transition-opacity ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="group bg-card rounded-lg p-2 pb-2.5 transition-transform ease-out duration-150 hover:-translate-y-0.5">
        {/* Inner relative container scopes the absolute-positioned overlays
            (drag handle, remove ×) to the cover area only — so `bottom-2`
            sits at the bottom of the cover, not below the title/author. */}
        <div className="relative mb-2.5">
          <Link to={`/books/${book.id}`} draggable={false} className="block">
            <div className={`relative bg-neutral-800 ${coverAspect} rounded overflow-hidden ring-1 ring-white/5 shadow-xl`}>
              {book.cover_path ? (
                <img src={book.cover_path} alt={book.title} draggable={false} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-neutral-700 to-neutral-900 gap-2">
                  <span className="text-5xl font-bold text-neutral-500 select-none leading-none">{titleInitial}</span>
                  <span className="text-xs text-neutral-500 font-medium leading-tight line-clamp-3 text-center">{book.title}</span>
                </div>
              )}
            </div>
          </Link>
          {/* Listeners go on the handle button (sibling of Link), NOT on the
              wrapper, so a plain click on the cover navigates to BookDetail
              without arming a drag. The handle only renders in `added` sort
              since other sorts ignore manual position. */}
          {draggable && (
            <button
              {...listeners}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm rounded px-2 py-1 text-neutral-400 hover:text-neutral-200 transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100"
              aria-label="Drag to reorder"
            >
              <DragHandle />
            </button>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(book.id)}
              className="absolute top-1 right-1 bg-black/80 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center text-neutral-400 hover:text-red-400 transition-colors text-base leading-none opacity-0 group-hover:opacity-100"
              title="Remove from list"
            >
              ×
            </button>
          )}
        </div>
        <p className={`text-sm font-medium truncate group-hover:text-white transition-colors ${book.is_stub ? 'text-neutral-400' : 'text-neutral-200'}`} title={book.title}>
          {book.title}
        </p>
        {book.authors?.length > 0 && (
          <p className="text-xs text-neutral-500 truncate mt-0.5" title={book.authors.map(a => a.name).join(', ')}>
            {formatAuthors(book.authors)}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] uppercase tracking-wider flex-wrap leading-tight">
          {book.is_stub                     && <span className="text-neutral-600">incomplete</span>}
          {book.owned                       ? <span className="text-emerald-700">owned</span> : <span className="text-neutral-700">unowned</span>}
          {book.status === 'finished'       && <span className="text-leather">read</span>}
          {book.rating != null              && <Stars rating={book.rating} />}
        </div>
      </div>
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const book = await api.createBook({ title: title.trim(), authors: author.trim() ? [author.trim()] : [], is_stub: true });
      await api.addToList(listId, book.id);
      onAdded(book);
      setTitle('');
      setAuthor('');
      setExpanded(false);
      titleRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
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
  const loadedRef = useRef(0);
  const genRef = useRef(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    let stale = false;
    genRef.current += 1;
    setLoading(true);
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
  }, [id, sort]);

  const loadMore = useCallback(async () => {
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
  }, [id, sort]);

  const loadAll = useCallback(async () => {
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
  }, [id, sort, total]);

  function handleAdded(book) {
    setList(l => ({ ...l, books: [{ ...book, added_at: new Date().toLocaleString('sv-SE') }, ...l.books] }));
    setTotal(t => t + 1);
    loadedRef.current += 1;
  }

  async function handleRemove(bookId) {
    setActionError(null);
    try {
      await api.removeFromList(id, bookId);
      setList(l => ({ ...l, books: l.books.filter(b => b.id !== bookId) }));
      setTotal(t => t - 1);
      loadedRef.current -= 1;
    } catch {
      // actionError, not error: this fails inline with the list intact.
      // The page-replacing `error` is reserved for load failures where
      // there's no list to render anyway.
      setActionError('Failed to remove book from list.');
    }
  }

  async function handleRename(e) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name || name === list.name) { setRenaming(false); return; }
    setRenameError(null);
    try {
      const updated = await api.renameList(id, name);
      setList(l => ({ ...l, name: updated.name }));
      setRenaming(false);
    } catch (err) {
      setRenameError(err.message);
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = list.books.findIndex(b => b.id === active.id);
    const newIndex = list.books.findIndex(b => b.id === over.id);
    const reordered = arrayMove(list.books, oldIndex, newIndex);
    setActionError(null);
    setList(l => ({ ...l, books: reordered }));
    api.reorderList(id, reordered.map(b => b.id)).catch(() => {
      setList(l => ({ ...l, books: arrayMove(l.books, newIndex, oldIndex) }));
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
            onClick={() => { setRenameValue(list.name); setRenaming(true); }}
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

      <QuickAdd listId={id} onAdded={handleAdded} />

      {total === 0 ? (
        <div className="text-center py-24">
          <p className="text-neutral-600">This list is empty. Add a book above.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-end mb-3">
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 transition-colors"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          {actionError && <p className="text-xs text-warn mb-2">{actionError}</p>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={list.books.map(b => b.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-4 gap-y-7 items-start">
                {list.books.map(book => (
                  <SortableListCard key={book.id} book={book} onRemove={handleRemove} draggable={draggable} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
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
