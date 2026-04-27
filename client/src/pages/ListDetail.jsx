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
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';

const PAGE_SIZE = 50;

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

function SortableRow({ book, onRemove, draggable }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${isDragging ? 'border-neutral-600 shadow-xl opacity-80' : book.is_stub ? 'bg-neutral-900/50 border-neutral-800/50' : 'bg-neutral-900 border-neutral-800'}`}
    >
      {draggable ? (
        <button
          {...attributes}
          {...listeners}
          className="text-neutral-600 hover:text-neutral-400 transition-colors cursor-grab active:cursor-grabbing flex-shrink-0"
          aria-label="Drag to reorder"
        >
          <DragHandle />
        </button>
      ) : (
        <div className="w-3.5 flex-shrink-0" />
      )}

      <div className={`w-9 ${book.format === 'audiobook' ? 'h-9' : 'h-[54px]'} flex-shrink-0 rounded overflow-hidden bg-neutral-800`}>
        {book.cover_path ? (
          <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link to={`/books/${book.id}`} className={`text-sm font-medium hover:text-white transition-colors truncate block ${book.is_stub ? 'text-neutral-400' : 'text-neutral-200'}`} title={book.title}>
            {book.title}
          </Link>
          {Boolean(book.is_stub) && (
            <span className="flex-shrink-0 text-xs text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5 leading-none">
              incomplete
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500 truncate mt-0.5">
          {[book.author, book.series && `${book.series}${book.series_number ? ` #${book.series_number}` : ''}`].filter(Boolean).join(' · ')}
        </p>
        {book.notes && (
          <p className="text-xs text-neutral-600 truncate mt-0.5">{book.notes}</p>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-4">
        <Stars rating={book.rating} />
        {book.format && book.format !== 'physical' && (
          <span className="text-xs text-neutral-600 capitalize hidden md:block">{book.format}</span>
        )}
        {book.owned ? (
          <span className="text-xs text-emerald-700 hidden sm:block">owned</span>
        ) : (
          <span className="text-xs text-neutral-700 hidden sm:block">unowned</span>
        )}
        {onRemove && (
          <button
            onClick={() => onRemove(book.id)}
            className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none"
            title="Remove from list"
          >
            ×
          </button>
        )}
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
      const book = await api.createBook({ title: title.trim(), author: author.trim() || undefined, is_stub: true });
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
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('added');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  const loadedRef = useRef(0);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    let stale = false;
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
      .catch(() => setError('Failed to load list.'))
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [id, sort]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const data = await api.getList(id, { sort, limit: PAGE_SIZE, offset: loadedRef.current });
      setList(l => ({ ...l, books: [...l.books, ...data.books] }));
      loadedRef.current += data.books.length;
    } catch {
    } finally {
      setLoadingMore(false);
    }
  }, [id, sort]);

  function handleAdded(book) {
    setList(l => ({ ...l, books: [{ ...book, added_at: new Date().toISOString() }, ...l.books] }));
    setTotal(t => t + 1);
    loadedRef.current += 1;
  }

  async function handleRemove(bookId) {
    try {
      await api.removeFromList(id, bookId);
      setList(l => ({ ...l, books: l.books.filter(b => b.id !== bookId) }));
      setTotal(t => t - 1);
      loadedRef.current -= 1;
    } catch {
      setError('Failed to remove book from list.');
    }
  }

  async function handleRename(e) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name || name === list.name) { setRenaming(false); return; }
    try {
      const updated = await api.renameList(id, name);
      setList(l => ({ ...l, name: updated.name }));
      setRenaming(false);
      setRenameError(null);
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
    setList(l => ({ ...l, books: reordered }));
    api.reorderList(id, reordered.map(b => b.id)).catch(() => {
      setList(l => ({ ...l, books: arrayMove(l.books, newIndex, oldIndex) }));
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={list.books.map(b => b.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {list.books.map(book => (
                  <SortableRow key={book.id} book={book} onRemove={handleRemove} draggable={draggable} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {sort !== 'added' && list.books.length < total && (
            <div className="mt-6 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-sm text-neutral-500 hover:text-neutral-300 disabled:opacity-40 transition-colors"
              >
                {loadingMore ? 'Loading…' : `Load more · ${total - list.books.length} remaining`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
