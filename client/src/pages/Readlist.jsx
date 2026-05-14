import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
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
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import { formatAuthors } from '../utils.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

const FROM_READLIST = { from: 'Readlist', fromPath: '/readlist' };

const TABS = [
  { key: 'physical',  label: 'Physical', formats: ['physical'] },
  { key: 'digital',   label: 'Digital',  formats: ['ebook'] },
  { key: 'audiobook', label: 'Audio',    formats: ['audiobook'] },
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

function SortableRow({ book, onRemove, index }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-3 rounded-lg bg-neutral-900 border transition-colors ${isDragging ? 'border-neutral-600 shadow-xl opacity-80' : 'border-neutral-800'}`}
    >
      <span className="text-xs text-neutral-700 tabular-nums w-5 text-right flex-shrink-0 select-none">
        {index + 1}
      </span>
      <button
        {...attributes}
        {...listeners}
        className="text-neutral-600 hover:text-neutral-400 transition-colors cursor-grab active:cursor-grabbing flex-shrink-0"
        aria-label="Drag to reorder"
      >
        <DragHandle />
      </button>

      <div className="w-9 h-[54px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {book.cover_path ? (
          <img src={book.cover_path} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <Link to={`/books/${book.id}`} state={FROM_READLIST} className="text-sm font-medium text-neutral-200 hover:text-white transition-colors truncate block" title={book.title}>
          {book.title}
        </Link>
        <p className="text-xs text-neutral-500 truncate mt-0.5">
          {[formatAuthors(book.authors), book.series && `${book.series}${book.series_number ? ` #${book.series_number}` : ''}`].filter(Boolean).join(' · ')}
        </p>
        {book.format === 'audiobook' && book.narrators?.length > 0 && (
          <p className="text-xs text-neutral-600 truncate mt-0.5">{formatAuthors(book.narrators)}</p>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-4">
        <Stars rating={book.rating} />
        {book.status && (
          <span className="text-xs text-neutral-600 capitalize hidden sm:block">{book.status}</span>
        )}
        <button
          onClick={() => onRemove(book.id)}
          className="text-neutral-700 hover:text-warn transition-colors text-lg leading-none"
          title="Remove from readlist"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default function Readlist() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Distinct from `error` (which replaces the whole list on load failure) —
  // transient mutation failures (reorder, remove) are non-fatal and the user
  // still needs to see the list, so we render this one as an inline banner
  // above the DnD context.
  const [actionError, setActionError] = useState(null);
  const [tab, setTab] = useState('physical');
  // Tracks book ids whose remove call is still in flight. Without this,
  // a fast double-click on the ✕ would fire two api.patchBook calls
  // before setBooks has filtered the row out — wasted work, and the
  // shape mirrors ListDetail's removingIdsRef.
  const removingIdsRef = useRef(new Set());
  // Bumped on every load so an in-flight reorder PUT whose .catch resolves
  // *after* a refresh-tick reload can detect that books has been replaced
  // with fresh server state — without this, the rollback to `previous`
  // would clobber the just-loaded readlist with a stale snapshot.
  const genRef = useRef(0);
  // Bumped on every drag so an earlier failed reorder whose .catch lands
  // *after* a later drag has already applied optimistically can detect
  // that it's stale — without this, A's rollback to its pre-A snapshot
  // would clobber B's newer optimistic order.
  const reorderSeqRef = useRef(0);
  const refreshTick = useRefreshTick();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    genRef.current += 1;
    // Drop any lingering reorder/remove banner at the start of a fresh
    // load. Without this, a "Failed to save readlist order" or
    // "Failed to remove book…" banner can sit above an already-refreshed
    // readlist after a refresh-tick reload. Start-clear (vs success-clear)
    // also stacks correctly with a load failure: the actionError clears,
    // and the more pressing setError('Failed to load readlist.') replaces
    // it instead of two banners stacking.
    setActionError(null);
    // Stale flag drops the response if the user navigates away before
    // getReadlist resolves — setBooks / setError / setLoading otherwise
    // fire on an unmounted component.
    let stale = false;
    api.getReadlist()
      .then(b => { if (!stale) { setBooks(b); setError(null); } })
      .catch(() => { if (!stale) setError('Failed to load readlist.'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [refreshTick]);

  const counts = useMemo(() => {
    const c = { physical: 0, digital: 0, audiobook: 0 };
    for (const b of books) {
      if (b.format === 'physical')  c.physical++;
      else if (b.format === 'ebook') c.digital++;
      else if (b.format === 'audiobook') c.audiobook++;
    }
    return c;
  }, [books]);

  const activeFormats = TABS.find(t => t.key === tab).formats;
  const visibleBooks  = useMemo(
    () => books.filter(b => activeFormats.includes(b.format)),
    [books, tab],
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = visibleBooks.findIndex(b => b.id === active.id);
    const newIdx = visibleBooks.findIndex(b => b.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reorderedVisible = arrayMove(visibleBooks, oldIdx, newIdx);
    // Splice the reordered tab items back into their original global slots,
    // leaving books from other tabs in place.
    const queue = [...reorderedVisible];
    const reorderedAll = books.map(b => activeFormats.includes(b.format) ? queue.shift() : b);
    const previous = books;  // snapshot for rollback if save fails
    setActionError(null);
    setBooks(reorderedAll);
    // Capture the load gen so a refresh-tick reload that lands between the
    // optimistic setBooks above and the .catch below isn't overwritten by
    // a stale rollback. Also gates the actionError so a failed-old-order
    // banner doesn't appear above an already-fresh readlist.
    const gen = genRef.current;
    // Capture the reorder seq so an earlier failed PUT whose .catch lands
    // after a later drag's optimistic apply doesn't restore a now-stale
    // pre-A snapshot over B's newer order.
    const reorderSeq = ++reorderSeqRef.current;
    api.reorderReadlist(reorderedAll.map(b => b.id)).catch(() => {
      if (gen !== genRef.current || reorderSeq !== reorderSeqRef.current) return;
      setBooks(previous);
      setActionError('Failed to save readlist order.');
    });
  }

  async function handleRemove(id) {
    if (removingIdsRef.current.has(id)) return;
    removingIdsRef.current.add(id);
    setActionError(null);
    try {
      await api.patchBook(id, { on_readlist: 0 });
      setBooks(bs => bs.filter(b => b.id !== id));
    } catch {
      setActionError('Failed to remove book from readlist.');
    } finally {
      removingIdsRef.current.delete(id);
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Readlist</h1>
        <div className="flex items-center gap-1">
          {TABS.map(t => {
            const n = counts[t.key];
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`text-sm px-3 py-1 rounded transition-colors ${active ? 'text-parchment bg-neutral-800/70' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                {t.label} <span className="text-xs text-neutral-600 tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div className="text-red-500 text-sm">{error}</div>
      ) : visibleBooks.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">No {TABS.find(t => t.key === tab).label.toLowerCase()} books on your readlist.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (<>
        {actionError && <p role="alert" className="text-xs text-warn mb-2">{actionError}</p>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleBooks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {visibleBooks.map((book, i) => (
                <SortableRow key={book.id} book={book} onRemove={handleRemove} index={i} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </>)}
    </div>
  );
}
