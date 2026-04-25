import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
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
import BookCard from '../components/BookCard.jsx';

function DragHandle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
    </svg>
  );
}

function SortableShelfRow({ book }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: book.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${isDragging ? 'border-neutral-600 shadow-xl opacity-80' : 'bg-neutral-900 border-neutral-800'}`}
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
        {book.cover_path
          ? <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover object-top" />
          : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
      </div>
      <Link to={`/books/${book.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-medium text-neutral-200 truncate hover:text-white transition-colors">{book.title}</p>
        {book.author && <p className="text-xs text-neutral-500 truncate mt-0.5">{book.author}</p>}
        {book.series && <p className="text-xs text-neutral-600 truncate mt-0.5">{book.series}{book.series_number != null ? ` #${book.series_number}` : ''}</p>}
      </Link>
    </div>
  );
}

const PROXIMITY_LABEL = { home: 'Home', nearby: 'Nearby', remote: 'Remote' };

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

export default function ShelfView() {
  const [params, setParams] = useSearchParams();
  const [tree, setTree] = useState([]);
  const [books, setBooks] = useState([]);
  const [unshelfed, setUnshelfed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [booksLoading, setBooksLoading] = useState(false);

  const buildingId = params.get('b') ? Number(params.get('b')) : null;
  const roomId     = params.get('r') ? Number(params.get('r')) : null;
  const unitId     = params.get('u') ? Number(params.get('u')) : null;
  const shelfId    = params.get('s') ? Number(params.get('s')) : null;

  useEffect(() => {
    Promise.all([api.getShelfTree(), api.getUnshelfedBooks()])
      .then(([t, u]) => { setTree(t); setUnshelfed(u); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!roomId && !unitId && !shelfId) { setBooks([]); return; }
    setBooksLoading(true);
    const fetch = shelfId ? api.getShelfBooks(shelfId)
      : unitId  ? api.getUnitBooks(unitId)
      : api.getRoomBooks(roomId);
    fetch.then(setBooks).finally(() => setBooksLoading(false));
  }, [roomId, unitId, shelfId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = books.findIndex(b => b.id === active.id);
    const newIndex = books.findIndex(b => b.id === over.id);
    const reordered = arrayMove(books, oldIndex, newIndex);
    setBooks(reordered);
    api.reorderShelf(shelfId, reordered.map(b => b.id));
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
    shelf    && { label: `Shelf ${shelf.label}`, action: null },
  ].filter(Boolean);

  if (loading) return <div className="text-neutral-700 text-sm">Loading…</div>;

  return (
    <div>
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

            {unshelfed.length > 0 && (
              <div className="mt-10">
                <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-4 pb-2 border-b border-neutral-800">
                  No location assigned · {unshelfed.length}
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7">
                  {unshelfed.map(book => (
                    <BookCard key={book.id} book={book} />
                  ))}
                </div>
              </div>
            )}
          </>
        )
      )}

      {/* Rooms */}
      {buildingId && !roomId && (
        rooms.length === 0 ? (
          <p className="text-neutral-600 text-sm">No rooms in this building.</p>
        ) : (
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
        )
      )}

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
          <div className="text-neutral-700 text-sm mt-6">Loading…</div>
        ) : books.length > 0 && (
          <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7 ${units.length > 0 ? 'mt-8' : ''}`}>
            {books.map(book => <BookCard key={book.id} book={book} />)}
          </div>
        )}
        {!booksLoading && units.length === 0 && books.length === 0 && (
          <p className="text-neutral-600 text-sm">No books in this room yet.</p>
        )}
      </>)}

      {/* Shelves + unit-level books */}
      {unitId && !shelfId && (<>
        {shelves.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shelves.map(s => (
              <LevelCard
                key={s.id}
                primary={`Shelf ${s.label}`}
                secondary={plural(s.book_count, 'book')}
                onClick={() => nav({ b: buildingId, r: roomId, u: unitId, s: s.id })}
              />
            ))}
          </div>
        )}
        {booksLoading ? (
          <div className="text-neutral-700 text-sm mt-6">Loading…</div>
        ) : books.length > 0 && (
          <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7 ${shelves.length > 0 ? 'mt-8' : ''}`}>
            {books.map(book => <BookCard key={book.id} book={book} />)}
          </div>
        )}
        {!booksLoading && shelves.length === 0 && books.length === 0 && (
          <p className="text-neutral-600 text-sm">No books in this unit yet.</p>
        )}
      </>)}

      {/* Shelf-level books */}
      {shelfId && (
        booksLoading ? (
          <div className="text-neutral-700 text-sm">Loading…</div>
        ) : books.length === 0 ? (
          <p className="text-neutral-600 text-sm">No books on this shelf yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={books.map(b => b.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {books.map(book => <SortableShelfRow key={book.id} book={book} />)}
              </div>
            </SortableContext>
          </DndContext>
        )
      )}
    </div>
  );
}
