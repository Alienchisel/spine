import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { initialsFor, formatPartialDate } from '../../utils.js';
import { useStaleGuard } from '../../hooks/useStaleGuard.js';

const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

function statusBadge(e) {
  if (e.status === 'finished') {
    return e.date_finished ? `Finished · ${formatPartialDate(e.date_finished)}` : 'Finished';
  }
  if (e.status === 'reading') return 'Reading';
  return 'Unread';
}

// Compact rating glyph: "5★", "4½★", "½★" — null/0 ratings render
// nothing. Drops the leading zero on a half-star-only rating so 0.5
// renders as "½★", not "0½★".
function ratingGlyph(r) {
  if (r == null || r <= 0) return null;
  const whole = Math.floor(r);
  const half  = (r % 1) ? '½' : '';
  return `${whole || ''}${half}★`;
}

function EditionRow({ edition, onUnlink, disabled, linkState }) {
  // Editions track their own rating + read_count (no propagation across
  // linked siblings, as of v1.49.0). Append both inline when set so the
  // user can see at a glance what they've done in this edition.
  const meta = [
    FORMAT_LABEL[edition.format] ?? edition.format,
    statusBadge(edition),
    ratingGlyph(edition.rating),
    edition.read_count > 0 ? `Read ${edition.read_count}×` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-3 py-2">
      <Link
        to={`/books/${edition.id}`}
        state={linkState}
        className="flex items-center gap-3 flex-1 min-w-0 group"
      >
        <div className="w-9 h-[54px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
          {edition.cover_path
            ? <img src={edition.cover_path} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-[10px] text-neutral-500 font-medium tracking-wide">{initialsFor(edition.title)}</div>}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-neutral-200 group-hover:text-white truncate transition-colors" title={edition.title}>{edition.title}</p>
          <p className="text-xs text-neutral-500 truncate" title={meta}>{meta}</p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onUnlink}
        disabled={disabled}
        className="text-neutral-700 hover:text-warn disabled:opacity-40 disabled:cursor-wait text-lg leading-none flex-shrink-0 transition-colors"
        title="Unlink this edition"
        aria-label={`Unlink edition ${edition.title}`}
      >
        ×
      </button>
    </div>
  );
}

export default function EditionsSection({ book, onChange, linkState }) {
  const editions = book.editions ?? [];
  const [picking, setPicking]   = useState(false);
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError]       = useState(null);
  const inputRef = useRef(null);
  // Bumped on every search dispatch — late responses for stale terms are
  // dropped instead of clobbering the visible list with old matches.
  // useStaleGuard's unmount listener also catches the "navigate away
  // mid-fetch" case the manual cleanup used to handle.
  const searchGuard = useStaleGuard();
  // Bumped on every link/unlink dispatch so an earlier mutation's onChange
  // (or the second-leg getBook in handleUnlink) can be dropped if a newer
  // mutation has already applied — without this, A's stale `updated`
  // snapshot can clobber B's already-applied edition list.
  const mutationGuard = useStaleGuard();
  // Visual lockout for the row whose mutation is in flight; lets us
  // disable that button so a fast double-click can't re-fire the same
  // PUT before the first resolves.
  const [mutatingId, setMutatingId] = useState(null);
  // Synchronous mirror of `mutatingId` keyed per row. The mutationGuard
  // protects state cleanup from stale .then() effects, but `mutatingId ===
  // otherId` reads stale state — two same-tick clicks on the same row
  // both pass the guard and fire duplicate linkEdition / unlinkEdition
  // calls before setMutatingId commits. Mirrors ListDetail.removingIdsRef.
  const mutatingIdsRef = useRef(new Set());

  useEffect(() => {
    if (picking) setTimeout(() => inputRef.current?.focus(), 0);
  }, [picking]);

  useEffect(() => {
    if (!picking) return;
    const term = query.trim();
    if (!term) { setResults([]); setSearching(false); setError(null); return; }
    const epoch = searchGuard.next();
    setSearching(true);
    setError(null);
    const debounce = setTimeout(() => {
      api.getBooks({ q: term, limit: 10 })
        .then(({ books }) => {
          if (!searchGuard.isFresh(epoch)) return;
          // Hide the current book and books already in this group — they
          // can't be link targets and would just clutter the result list.
          const hidden = new Set([book.id, ...editions.map(e => e.id)]);
          setResults(books.filter(b => !hidden.has(b.id)));
        })
        .catch(() => { if (searchGuard.isFresh(epoch)) setError('Search failed.'); })
        .finally(() => { if (searchGuard.isFresh(epoch)) setSearching(false); });
    }, 200);
    return () => clearTimeout(debounce);
  }, [query, picking, book.id, editions]);

  function closePicker() {
    setPicking(false);
    setQuery('');
    setResults([]);
    setSearching(false);
    setError(null);
  }

  async function handlePick(otherId) {
    if (mutatingIdsRef.current.has(otherId) || mutatingId === otherId) return;
    mutatingIdsRef.current.add(otherId);
    setError(null);
    setMutatingId(otherId);
    const epoch = mutationGuard.next();
    try {
      const updated = await api.linkEdition(book.id, otherId);
      if (!mutationGuard.isFresh(epoch)) return;
      onChange(updated);
      closePicker();
    } catch {
      if (!mutationGuard.isFresh(epoch)) return;
      setError('Failed to link edition.');
    } finally {
      mutatingIdsRef.current.delete(otherId);
      // Only clear the visual lock if THIS mutation is still the latest;
      // otherwise a newer mutation has already overwritten mutatingId for
      // its own row and we'd un-disable the wrong button.
      if (mutationGuard.isFresh(epoch)) setMutatingId(null);
    }
  }

  async function handleUnlink(otherId) {
    if (mutatingIdsRef.current.has(otherId) || mutatingId === otherId) return;
    mutatingIdsRef.current.add(otherId);
    setError(null);
    setMutatingId(otherId);
    const epoch = mutationGuard.next();
    try {
      // Unlink the SIBLING, not self — the visible effect (sibling row
      // disappears from this book's list) is what the ✕ click implies.
      // Self stays in the group if other siblings remain.
      await api.unlinkEdition(otherId);
      if (!mutationGuard.isFresh(epoch)) return;
      const refreshed = await api.getBook(book.id);
      if (!mutationGuard.isFresh(epoch)) return;
      onChange(refreshed);
    } catch {
      if (!mutationGuard.isFresh(epoch)) return;
      setError('Failed to unlink edition.');
    } finally {
      mutatingIdsRef.current.delete(otherId);
      if (mutationGuard.isFresh(epoch)) setMutatingId(null);
    }
  }

  if (editions.length === 0 && !picking) {
    return (
      <div className="border-t border-neutral-800 pt-5 mb-6">
        <button
          type="button"
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
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
        Other editions of this work
      </p>
      {error && <p role="alert" className="text-xs text-warn mb-2">{error}</p>}
      <div className="divide-y divide-neutral-800/60">
        {editions.map(e => (
          <EditionRow key={e.id} edition={e} onUnlink={() => handleUnlink(e.id)} disabled={mutatingId === e.id} linkState={linkState} />
        ))}
      </div>

      {picking ? (
        <div className="mt-3 space-y-2">
          <input
            ref={inputRef}
            type="search"
            value={query}
            aria-label="Search library to link an edition"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') closePicker(); }}
            placeholder="Search your library by title…"
            className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50"
          />
          {searching && <p role="status" className="text-xs text-neutral-600">Searching…</p>}
          {!searching && query.trim() && results.length === 0 && (
            <p role="status" className="text-xs text-neutral-600">No matches.</p>
          )}
          {results.length > 0 && (
            <div className="border border-neutral-800 rounded max-h-64 overflow-y-auto">
              {results.map(r => {
                const formatLabel = FORMAT_LABEL[r.format] ?? r.format;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handlePick(r.id)}
                    disabled={mutatingId === r.id}
                    className="w-full text-left flex items-center gap-3 px-2 py-1.5 hover:bg-neutral-800/60 disabled:opacity-50 disabled:cursor-wait transition-colors"
                  >
                    <div className="w-7 h-[42px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
                      {r.cover_path
                        ? <img src={r.cover_path} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-[10px] text-neutral-500 font-medium tracking-wide">{initialsFor(r.title)}</div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-200 truncate" title={r.title}>{r.title}</p>
                      <p className="text-xs text-neutral-500 truncate" title={formatLabel}>{formatLabel}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={closePicker}
            className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="mt-2 text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          + Link another
        </button>
      )}
    </div>
  );
}
