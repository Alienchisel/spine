import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { api } from '../api.js';
import { initialsFor } from '../utils.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

const MAX_SLOTS = 5;

// Hand-curated top-five favourites — a "bookshop window" row of oversized
// covers, ranked 1–5 left-to-right. No on-cover text (consistent with the
// cover-first design language across the rest of Spine); hover reveals the
// rank + reorder/remove tray. Adding a pick happens on BookDetail.
export default function Showcase() {
  const { pathname, search } = useLocation();
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const refreshTick = useRefreshTick();

  useEffect(() => {
    let stale = false;
    api.getBooks({ showcase: 1, sort: 'showcase', limit: MAX_SLOTS })
      .then(({ books }) => { if (!stale) { setBooks(books); setError(null); } })
      .catch(() => { if (!stale) setError('Failed to load showcase.'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [refreshTick]);

  // Reorder writes a fresh dense 1..N sequence so we never leak the prior
  // gaps to disk. Cheap (at most five PATCHes) and keeps positions honest
  // for the next add.
  async function persist(next) {
    setBusy(true);
    try {
      const renumbered = next.map((b, i) => ({ ...b, showcase_position: i + 1 }));
      setBooks(renumbered);
      await Promise.all(renumbered.map(b => api.patchBook(b.id, { showcase_position: b.showcase_position })));
      setError(null);
    } catch {
      setError('Failed to save changes — refresh to see the current state.');
    } finally {
      setBusy(false);
    }
  }

  function moveLeft(idx) {
    if (idx <= 0) return;
    const next = [...books];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    persist(next);
  }

  function moveRight(idx) {
    if (idx >= books.length - 1) return;
    const next = [...books];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    persist(next);
  }

  async function remove(book) {
    setBusy(true);
    try {
      const next = books.filter(b => b.id !== book.id);
      const renumbered = next.map((b, i) => ({ ...b, showcase_position: i + 1 }));
      setBooks(renumbered);
      await api.patchBook(book.id, { showcase_position: null });
      // Reflow remaining picks so positions stay dense — same write the
      // BookDetail action expects to find when picking the next empty slot.
      await Promise.all(renumbered.map(b => api.patchBook(b.id, { showcase_position: b.showcase_position })));
      setError(null);
    } catch {
      setError('Failed to remove — refresh to see the current state.');
    } finally {
      setBusy(false);
    }
  }

  // detailReturnState carries the cohort so BookDetail's prev/next can hop
  // through the row in rank order (the same threading every other curated
  // surface uses).
  const detailReturnState = {
    from: 'Showcase',
    fromPath: pathname + search,
    cohort: books.map(b => ({ id: b.id, title: b.title })),
  };

  return (
    <div>
      <IncomingBackLink />
      <h1 className="text-xl font-bold text-white mb-2">Showcase</h1>
      <p className="text-sm text-neutral-500 mb-8">
        Your top {MAX_SLOTS} — hand-ranked. Add or replace from any book&apos;s detail page.
      </p>

      {books.length > 0 && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
          {Array.from({ length: MAX_SLOTS }).map((_, i) => (
            <div key={i} className="aspect-[2/3] bg-neutral-900 rounded animate-pulse" />
          ))}
        </div>
      ) : books.length === 0 && error ? (
        <div role="alert" className="text-red-500 text-sm">{error}</div>
      ) : books.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No picks yet. Open a book and click <span className="text-neutral-400">+ Add to Showcase</span> to put it on the row.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
          {books.map((b, idx) => (
            <Slot
              key={b.id}
              book={b}
              rank={idx + 1}
              canMoveLeft={idx > 0}
              canMoveRight={idx < books.length - 1}
              onMoveLeft={() => moveLeft(idx)}
              onMoveRight={() => moveRight(idx)}
              onRemove={() => remove(b)}
              linkState={detailReturnState}
              disabled={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Slot({ book, rank, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight, onRemove, linkState, disabled }) {
  const label = `#${rank} — ${book.title}${book.authors_display ? ' — ' + book.authors_display : ''}`;
  return (
    <div className="group relative">
      <Link
        to={`/books/${book.id}`}
        state={linkState}
        title={label}
        className="block relative aspect-[2/3] bg-neutral-800 rounded overflow-hidden shadow-lg"
      >
        {book.cover_path ? (
          <img src={book.cover_path} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-neutral-700 to-neutral-900 gap-2">
            <span className="text-5xl font-bold text-neutral-500 select-none leading-none tracking-wide">
              {initialsFor(book.authors_display || book.title)}
            </span>
            <span className="text-xs text-neutral-500 font-medium leading-tight line-clamp-3 text-center">{book.title}</span>
          </div>
        )}
        {/* Rank chip — always visible, top-left. Pure number, no label,
            to stay consistent with the no-on-cover-text convention used
            on the rest of the grids. */}
        <div className="absolute top-2 left-2 bg-black/75 text-leather text-sm font-bold px-2 py-0.5 rounded backdrop-blur-sm leading-none">
          {rank}
        </div>
        <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-binding/25 group-hover:ring-[#ffffff99] transition-[box-shadow] duration-200 rounded" />
      </Link>
      {/* Reorder + remove tray — same hover-revealed dark tray pattern as
          BookCard's action strip. Reorder by horizontal arrows so the
          mental model matches the left-to-right rank. */}
      <div className="absolute inset-x-3 bottom-3 flex justify-center items-center gap-4 px-3 py-1.5 bg-black/80 backdrop-blur-sm rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={disabled || !canMoveLeft}
          aria-label="Move up a rank"
          title="Move up a rank"
          className="text-white hover:text-indigo-300 transition-colors disabled:opacity-30 disabled:hover:text-white"
        >
          ←
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove from Showcase"
          title="Remove from Showcase"
          className="text-white hover:text-red-300 transition-colors disabled:opacity-30"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={disabled || !canMoveRight}
          aria-label="Move down a rank"
          title="Move down a rank"
          className="text-white hover:text-indigo-300 transition-colors disabled:opacity-30 disabled:hover:text-white"
        >
          →
        </button>
      </div>
    </div>
  );
}
