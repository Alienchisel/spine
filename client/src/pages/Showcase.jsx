import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { api } from '../api.js';
import { initialsFor } from '../utils.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

const MAX_SLOTS = 5;

// Hand-curated favourites — sections of up to five hand-ranked picks, one
// section per entity type. Books shipped first (1.202.0); Authors followed
// (1.202.6) using the same shape — same column, same PATCH validator, same
// /api/<entity>?showcase=1 endpoint — so the page is a vertical stack of
// near-identical sections.
export default function Showcase() {
  const { pathname, search } = useLocation();
  const refreshTick = useRefreshTick();

  const books = useShowcaseRow({
    fetch:    () => api.getBooks({ showcase: 1, sort: 'showcase', limit: MAX_SLOTS }).then(({ books }) => books),
    patchOne: (id, slot) => api.patchBook(id, { showcase_position: slot }),
    refreshTick,
  });

  const authors = useShowcaseRow({
    fetch:    () => api.getAuthors({ showcase: 1 }),
    patchOne: (id, slot) => api.updateAuthor(id, { showcase_position: slot }),
    refreshTick,
  });

  // detailReturnState carries the cohort so BookDetail's prev/next can hop
  // through the row in rank order. Authors don't currently use a cohort
  // shape on AuthorDetail, so we just thread a friendly back-link.
  const bookReturnState = {
    from: 'Showcase',
    fromPath: pathname + search,
    cohort: books.items.map(b => ({ id: b.id, title: b.title })),
  };
  const authorReturnState = { from: 'Showcase', fromPath: pathname + search };

  return (
    <div>
      <IncomingBackLink />
      <h1 className="text-xl font-bold text-white mb-2">Showcase</h1>
      <p className="text-sm text-neutral-500 mb-10">
        Your top {MAX_SLOTS} — hand-ranked. Add or replace from any book or author&apos;s page.
      </p>

      <ShowcaseSection
        heading="Books"
        row={books}
        toItem={(b, rank) => ({
          id: b.id, label: b.title, image_path: b.cover_path,
          linkTo: `/books/${b.id}`, hover: `#${rank} — ${b.title}${b.authors_display ? ' — ' + b.authors_display : ''}`,
        })}
        linkState={bookReturnState}
        emptyHint={
          <>No picks yet. Open a book and click <span className="text-neutral-400">+ Add to Showcase</span> to put it on the row.</>
        }
      />

      <div className="mt-12">
        <ShowcaseSection
          heading="Authors"
          row={authors}
          toItem={(a, rank) => ({
            id: a.id, label: a.name, image_path: a.photo_path,
            linkTo: `/authors/${a.id}`, hover: `#${rank} — ${a.name}`,
          })}
          linkState={authorReturnState}
          emptyHint={
            <>No picks yet. Open an author and click <span className="text-neutral-400">+ Add to Showcase</span> to put them on the row.</>
          }
        />
      </div>
    </div>
  );
}

// Owns the picks list, busy state, and the persist/remove/move logic for
// one section of the page. PATCHes run sequentially so a failure in the
// middle of a renumber bails immediately rather than half-writing the
// row — the prior snapshot is restored locally and a refetch reconciles
// with what's actually on disk.
function useShowcaseRow({ fetch, patchOne, refreshTick }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    fetch()
      .then(rows => { if (!stale) { setItems(Array.isArray(rows) ? rows : []); setError(null); } })
      .catch(() => { if (!stale) setError('Failed to load showcase.'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // fetch identity changes per render but is logically stable per row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  async function syncFromServer() {
    try { setItems(await fetch().then(rows => Array.isArray(rows) ? rows : [])); } catch { /* silent */ }
  }

  async function persist(next) {
    setBusy(true);
    const prior = items;
    const renumbered = next.map((x, i) => ({ ...x, showcase_position: i + 1 }));
    setItems(renumbered);
    try {
      for (const x of renumbered) await patchOne(x.id, x.showcase_position);
      setError(null);
    } catch {
      setError('Failed to save changes — restored to the last saved order.');
      setItems(prior);
      await syncFromServer();
    } finally {
      setBusy(false);
    }
  }

  function moveLeft(idx) {
    if (idx <= 0) return;
    const next = [...items];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    persist(next);
  }

  function moveRight(idx) {
    if (idx >= items.length - 1) return;
    const next = [...items];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    persist(next);
  }

  async function remove(item) {
    setBusy(true);
    const prior = items;
    const next = items.filter(x => x.id !== item.id);
    const renumbered = next.map((x, i) => ({ ...x, showcase_position: i + 1 }));
    setItems(renumbered);
    try {
      await patchOne(item.id, null);
      for (const x of renumbered) await patchOne(x.id, x.showcase_position);
      setError(null);
    } catch {
      setError('Failed to remove — restored to the last saved order.');
      setItems(prior);
      await syncFromServer();
    } finally {
      setBusy(false);
    }
  }

  return { items, loading, error, busy, moveLeft, moveRight, remove, dismissError: () => setError(null) };
}

function ShowcaseSection({ heading, row, toItem, linkState, emptyHint }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-4">{heading}</h2>
      {row.items.length > 0 && (
        <ErrorBanner message={row.error} onDismiss={row.dismissError} className="mb-4" />
      )}
      {row.loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
          {Array.from({ length: MAX_SLOTS }).map((_, i) => (
            <div key={i} className="aspect-[2/3] bg-neutral-900 rounded animate-pulse" />
          ))}
        </div>
      ) : row.items.length === 0 && row.error ? (
        <div role="alert" className="text-red-500 text-sm">{row.error}</div>
      ) : row.items.length === 0 ? (
        <p className="text-sm text-neutral-600">{emptyHint}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
          {row.items.map((x, idx) => (
            <Slot
              key={x.id}
              item={toItem(x, idx + 1)}
              rank={idx + 1}
              canMoveLeft={idx > 0}
              canMoveRight={idx < row.items.length - 1}
              onMoveLeft={() => row.moveLeft(idx)}
              onMoveRight={() => row.moveRight(idx)}
              onRemove={() => row.remove(x)}
              linkState={linkState}
              disabled={row.busy}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Slot({ item, rank, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight, onRemove, linkState, disabled }) {
  return (
    <div className="group relative">
      <Link
        to={item.linkTo}
        state={linkState}
        title={item.hover}
        className="block relative aspect-[2/3] bg-neutral-800 rounded overflow-hidden shadow-lg"
      >
        {item.image_path ? (
          <img src={item.image_path} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-neutral-700 to-neutral-900 gap-2">
            <span className="text-5xl font-bold text-neutral-500 select-none leading-none tracking-wide">
              {initialsFor(item.label)}
            </span>
            <span className="text-xs text-neutral-500 font-medium leading-tight line-clamp-3 text-center">{item.label}</span>
          </div>
        )}
        {/* Rank chip — always visible, top-left. Pure number, no label,
            to stay consistent with the no-on-cover-text convention used
            on the rest of the grids. select-none so a Cmd+A on the page
            doesn't pollute the clipboard with "1 2 3 4 5" alongside the
            five titles. */}
        <div className="absolute top-2 left-2 bg-black/75 text-leather text-sm font-bold px-2 py-0.5 rounded backdrop-blur-sm leading-none select-none">
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
