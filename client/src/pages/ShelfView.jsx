import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';

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
  const [loading, setLoading] = useState(true);
  const [booksLoading, setBooksLoading] = useState(false);

  const buildingId = params.get('b') ? Number(params.get('b')) : null;
  const roomId     = params.get('r') ? Number(params.get('r')) : null;
  const unitId     = params.get('u') ? Number(params.get('u')) : null;
  const shelfId    = params.get('s') ? Number(params.get('s')) : null;

  useEffect(() => {
    api.getShelfTree().then(setTree).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!shelfId) { setBooks([]); return; }
    setBooksLoading(true);
    api.getShelfBooks(shelfId).then(setBooks).finally(() => setBooksLoading(false));
  }, [shelfId]);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tree.map(b => (
              <LevelCard
                key={b.id}
                primary={b.name}
                secondary={`${PROXIMITY_LABEL[b.proximity]} · ${plural(b.rooms.length, 'room')}`}
                onClick={() => nav({ b: b.id })}
              />
            ))}
          </div>
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
                secondary={plural(r.units.length, 'unit')}
                onClick={() => nav({ b: buildingId, r: r.id })}
              />
            ))}
          </div>
        )
      )}

      {/* Units */}
      {roomId && !unitId && (
        units.length === 0 ? (
          <p className="text-neutral-600 text-sm">No units in this room.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {units.map(u => (
              <LevelCard
                key={u.id}
                primary={u.name}
                secondary={plural(u.shelves.length, 'shelf', 'shelves')}
                onClick={() => nav({ b: buildingId, r: roomId, u: u.id })}
              />
            ))}
          </div>
        )
      )}

      {/* Shelves */}
      {unitId && !shelfId && (
        shelves.length === 0 ? (
          <p className="text-neutral-600 text-sm">No shelves in this unit.</p>
        ) : (
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
        )
      )}

      {/* Books */}
      {shelfId && (
        booksLoading ? (
          <div className="text-neutral-700 text-sm">Loading…</div>
        ) : books.length === 0 ? (
          <p className="text-neutral-600 text-sm">No books on this shelf yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7">
            {books.map(book => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
