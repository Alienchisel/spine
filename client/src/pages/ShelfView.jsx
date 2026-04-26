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
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';

function SortableShelfCover({ book }) {
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
        <Link to={`/books/${book.id}`} draggable={false} className="block">
          <div className="w-[240px] h-[360px] rounded overflow-hidden bg-neutral-800 shadow-xl ring-1 ring-white/5 hover:ring-white/20 transition-all hover:scale-[1.02] duration-200">
            {book.cover_path
              ? <img src={book.cover_path} alt={book.title} draggable={false} className="w-full h-full object-cover object-top" />
              : <div className="w-full h-full flex items-end p-2 bg-gradient-to-br from-neutral-700 to-neutral-900">
                  <span className="text-xs text-neutral-400 leading-tight line-clamp-4">{book.title}</span>
                </div>}
          </div>
        </Link>
        <button
          {...listeners}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded px-2 py-1 text-neutral-500 hover:text-neutral-200 transition-colors cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100"
          aria-label="Drag to reorder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M2.75 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 4Zm0 4a.75.75 0 0 1 .75-.75h9a.75.75 0 0 1 0 1.5h-9A.75.75 0 0 1 2.75 8Zm.75 3.25a.75.75 0 0 0 0 1.5h9a.75.75 0 0 0 0-1.5h-9Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-neutral-500 mt-2 w-[240px] truncate">{book.title}</p>
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
    if (!buildingId && !roomId && !unitId && !shelfId) { setBooks([]); return; }
    setBooksLoading(true);
    const fetch = shelfId    ? api.getShelfBooks(shelfId)
      : unitId              ? api.getUnitBooks(unitId)
      : roomId              ? api.getRoomBooks(roomId)
      : api.getBuildingBooks(buildingId);
    fetch.then(setBooks).finally(() => setBooksLoading(false));
  }, [buildingId, roomId, unitId, shelfId]);

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
          <div className="text-neutral-700 text-sm mt-6">Loading…</div>
        ) : books.length > 0 && (
          <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7 ${rooms.length > 0 ? 'mt-8' : ''}`}>
            {books.map(book => <BookCard key={book.id} book={book} />)}
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
            <SortableContext items={books.map(b => b.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex gap-4 overflow-x-auto pb-6 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:h-0.5 [&::-webkit-scrollbar-thumb]:bg-neutral-700 [&::-webkit-scrollbar-thumb]:rounded-full">
                {books.map(book => <SortableShelfCover key={book.id} book={book} />)}
              </div>
            </SortableContext>
          </DndContext>
        )
      )}
    </div>
  );
}
