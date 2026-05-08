import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';

const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

function statusBadge(e) {
  if (e.status === 'finished') {
    return e.date_finished ? `Finished · ${e.date_finished}` : 'Finished';
  }
  if (e.status === 'reading') return 'Reading';
  return 'Unread';
}

function EditionRow({ edition, onUnlink, disabled }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Link
        to={`/books/${edition.id}`}
        className="flex items-center gap-3 flex-1 min-w-0 group"
      >
        <div className="w-9 h-[54px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
          {edition.cover_path
            ? <img src={edition.cover_path} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-neutral-200 group-hover:text-white truncate transition-colors">{edition.title}</p>
          <p className="text-xs text-neutral-500 truncate">
            {FORMAT_LABEL[edition.format] ?? edition.format} · {statusBadge(edition)}
          </p>
        </div>
      </Link>
      <button
        onClick={onUnlink}
        disabled={disabled}
        className="text-neutral-700 hover:text-warn disabled:opacity-40 disabled:cursor-wait text-lg leading-none flex-shrink-0 transition-colors"
        title="Unlink this edition"
      >
        ×
      </button>
    </div>
  );
}

export default function EditionsSection({ book, onChange }) {
  const editions = book.editions ?? [];
  const [picking, setPicking]   = useState(false);
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError]       = useState(null);
  const inputRef = useRef(null);
  // Bumped on every search dispatch — late responses for stale terms are
  // dropped instead of clobbering the visible list with old matches.
  const searchGenRef = useRef(0);
  // Bumped on every link/unlink dispatch so an earlier mutation's onChange
  // (or the second-leg getBook in handleUnlink) can be dropped if a newer
  // mutation has already applied — without this, A's stale `updated`
  // snapshot can clobber B's already-applied edition list. Mirrors the
  // seq guard pattern used across Spine's async actions.
  const mutationSeqRef = useRef(0);
  // Visual lockout for the row whose mutation is in flight; lets us
  // disable that button so a fast double-click can't re-fire the same
  // PUT before the first resolves.
  const [mutatingId, setMutatingId] = useState(null);

  useEffect(() => {
    if (picking) setTimeout(() => inputRef.current?.focus(), 0);
  }, [picking]);

  useEffect(() => {
    if (!picking) return;
    const term = query.trim();
    if (!term) { setResults([]); setSearching(false); return; }
    const gen = ++searchGenRef.current;
    setSearching(true);
    const debounce = setTimeout(() => {
      api.getBooks({ q: term, limit: 10 })
        .then(({ books }) => {
          if (gen !== searchGenRef.current) return;
          // Hide the current book and books already in this group — they
          // can't be link targets and would just clutter the result list.
          const hidden = new Set([book.id, ...editions.map(e => e.id)]);
          setResults(books.filter(b => !hidden.has(b.id)));
        })
        .catch(() => { if (gen === searchGenRef.current) setError('Search failed.'); })
        .finally(() => { if (gen === searchGenRef.current) setSearching(false); });
    }, 200);
    return () => clearTimeout(debounce);
  }, [query, picking, book.id, editions]);

  async function handlePick(otherId) {
    if (mutatingId === otherId) return;
    setError(null);
    setMutatingId(otherId);
    const seq = ++mutationSeqRef.current;
    try {
      const updated = await api.linkEdition(book.id, otherId);
      if (seq !== mutationSeqRef.current) return;
      onChange(updated);
      setPicking(false);
      setQuery('');
      setResults([]);
    } catch {
      if (seq !== mutationSeqRef.current) return;
      setError('Failed to link edition.');
    } finally {
      // Only clear the visual lock if THIS mutation is still the latest;
      // otherwise a newer mutation has already overwritten mutatingId for
      // its own row and we'd un-disable the wrong button.
      if (seq === mutationSeqRef.current) setMutatingId(null);
    }
  }

  async function handleUnlink(otherId) {
    if (mutatingId === otherId) return;
    setError(null);
    setMutatingId(otherId);
    const seq = ++mutationSeqRef.current;
    try {
      // Unlink the SIBLING, not self — the visible effect (sibling row
      // disappears from this book's list) is what the ✕ click implies.
      // Self stays in the group if other siblings remain.
      await api.unlinkEdition(otherId);
      if (seq !== mutationSeqRef.current) return;
      const refreshed = await api.getBook(book.id);
      if (seq !== mutationSeqRef.current) return;
      onChange(refreshed);
    } catch {
      if (seq !== mutationSeqRef.current) return;
      setError('Failed to unlink edition.');
    } finally {
      if (seq === mutationSeqRef.current) setMutatingId(null);
    }
  }

  if (editions.length === 0 && !picking) {
    return (
      <div className="border-t border-neutral-800 pt-5 mb-6">
        <button
          onClick={() => setPicking(true)}
          className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          + Link another edition of this work
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-neutral-800 pt-5 mb-6">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
        Other editions of this work
      </p>
      {error && <p className="text-xs text-warn mb-2">{error}</p>}
      <div className="divide-y divide-neutral-800/60">
        {editions.map(e => (
          <EditionRow key={e.id} edition={e} onUnlink={() => handleUnlink(e.id)} disabled={mutatingId === e.id} />
        ))}
      </div>

      {picking ? (
        <div className="mt-3 space-y-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setPicking(false); setQuery(''); } }}
            placeholder="Search your library by title…"
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50"
          />
          {searching && <p className="text-xs text-neutral-600">Searching…</p>}
          {!searching && query.trim() && results.length === 0 && (
            <p className="text-xs text-neutral-600">No matches.</p>
          )}
          {results.length > 0 && (
            <div className="border border-neutral-800 rounded max-h-64 overflow-y-auto">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => handlePick(r.id)}
                  disabled={mutatingId === r.id}
                  className="w-full text-left flex items-center gap-3 px-2 py-1.5 hover:bg-neutral-800/60 disabled:opacity-50 disabled:cursor-wait transition-colors"
                >
                  <div className="w-7 h-[42px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
                    {r.cover_path
                      ? <img src={r.cover_path} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-neutral-200 truncate">{r.title}</p>
                    <p className="text-xs text-neutral-500 truncate">
                      {FORMAT_LABEL[r.format] ?? r.format}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => { setPicking(false); setQuery(''); }}
            className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setPicking(true)}
          className="mt-2 text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          + Link another
        </button>
      )}
    </div>
  );
}
