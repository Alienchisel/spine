import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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

function DragHandle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
    </svg>
  );
}

function SortableRow({ book, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-3 rounded-lg bg-neutral-900 border transition-colors ${isDragging ? 'border-neutral-600 shadow-xl opacity-80' : 'border-neutral-800'}`}
    >
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
          <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <Link to={`/books/${book.id}`} className="text-sm font-medium text-neutral-200 hover:text-white transition-colors truncate block">
          {book.title}
        </Link>
        {book.author && (
          <p className="text-xs text-neutral-500 truncate mt-0.5">{book.author}</p>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-3">
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    api.getReadlist().then(setBooks).finally(() => setLoading(false));
  }, []);

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = books.findIndex(b => b.id === active.id);
    const newIndex = books.findIndex(b => b.id === over.id);
    const reordered = arrayMove(books, oldIndex, newIndex);
    setBooks(reordered);
    api.reorderReadlist(reordered.map(b => b.id));
  }

  async function handleRemove(id) {
    await api.patchBook(id, { on_readlist: 0 });
    setBooks(bs => bs.filter(b => b.id !== id));
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold text-white mb-6">Readlist</h1>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : books.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">Your readlist is empty.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={books.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {books.map(book => (
                <SortableRow key={book.id} book={book} onRemove={handleRemove} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
