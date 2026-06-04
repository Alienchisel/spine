import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatAuthors, initialsFor, fmtHM, plural, pluralWord } from '../utils.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';

const FROM_READLIST = { from: 'Readlist', fromPath: '/readlist' };

// Length buckets — generalised, not tuned to a specific corpus. Books
// without length data fall through any non-Any filter (the picker has
// no information to bucket them by).
const TIME_BUCKETS = [
  { key: 'any',    label: 'Any length' },
  { key: 'short',  label: 'An evening',     pageMax: 250,  audioMinMax: 360  /* 6h */ },
  { key: 'medium', label: 'A few sittings', pageMin: 250, pageMax: 450, audioMinMin: 360, audioMinMax: 900 /* 6-15h */ },
  { key: 'long',   label: 'A commitment',   pageMin: 450, audioMinMin: 900 },
];
const FORMAT_PICKER = [
  { key: 'any',       label: 'Any format' },
  { key: 'physical',  label: 'Physical',  fmt: 'physical' },
  { key: 'ebook',     label: 'Digital',   fmt: 'ebook' },
  { key: 'audiobook', label: 'Audio',     fmt: 'audiobook' },
];
const PICK_COUNT = 10;
// Rows shown by default in the housekeeping list before the "Show all"
// disclosure kicks in. Server orders by readlist_position ASC (oldest
// added first), so the visible preview is exactly the staleness cohort
// — what someone in pruning mode wants to see first.
const QUEUE_PREVIEW = 10;
// Mulberry32 — small seeded PRNG so 'Reshuffle' gives a deterministic
// but different ordering each time, without depending on Math.random
// which would change every render.
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const out = [...arr];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Length label shown on a pick card — pages for non-audio, h/m for
// audio, dash when neither is known so the row reads cleanly instead
// of carrying a misleading 0.
function lengthLabel(book) {
  if (book.format === 'audiobook') {
    return book.duration_minutes ? fmtHM(book.duration_minutes) : '—';
  }
  return book.page_count ? `${book.page_count} ${pluralWord(book.page_count, 'page')}` : '—';
}

function PickCard({ book }) {
  const meta = [formatAuthors(book.authors), lengthLabel(book)].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/books/${book.id}`}
      state={FROM_READLIST}
      className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-oak/40 rounded transition-all"
    >
      <div className="aspect-[2/3] bg-neutral-800 rounded overflow-hidden shadow-lg ring-1 ring-binding/25 group-hover:ring-leather/60 transition-shadow">
        {book.cover_path ? (
          <img src={book.cover_path} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl text-neutral-500 font-medium tracking-wide bg-gradient-to-br from-neutral-700 to-neutral-900">
            {initialsFor(book.title)}
          </div>
        )}
      </div>
      <p className="text-sm text-parchment group-hover:text-leather transition-colors mt-2 line-clamp-2 leading-snug">
        {book.title}
      </p>
      <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{meta}</p>
    </Link>
  );
}

export default function Readlist() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Picker constraint state — transient, not URL-persisted, doesn't
  // outlive the session. The picker is for "what should I pick right
  // now?", a moment-bound question.
  const [pickTime, setPickTime] = useState('any');
  const [pickFormat, setPickFormat] = useState('any');
  const [pickTags, setPickTags] = useState(() => new Set());
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const [showAllQueue, setShowAllQueue] = useState(false);
  const guard = useStaleGuard();
  const refreshTick = useRefreshTick();

  useEffect(() => {
    const epoch = guard.next();
    api.getReadlist()
      .then(b => { if (guard.isFresh(epoch)) { setBooks(b); setError(null); } })
      .catch(() => { if (guard.isFresh(epoch)) setError('Failed to load readlist.'); })
      .finally(() => { if (guard.isFresh(epoch)) setLoading(false); });
  }, [refreshTick]);

  // Top tags across the whole readlist, ordered by frequency. Used as
  // the picker's tag-chip palette so the user picks from tags that
  // *actually appear* in their queue rather than picking from the
  // global library taxonomy (which would surface tags whose readlist
  // hits are zero).
  const topReadlistTags = useMemo(() => {
    const counts = new Map();
    for (const b of books) {
      for (const t of (b.tags || [])) {
        if (t.virtual) continue;
        counts.set(t.name, (counts.get(t.name) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [books]);

  // Shared filter predicate — extracted so the per-pill availability
  // counts below can reuse it without duplicating the bucket-bounds
  // and tag-intersection logic. Length filter is best-effort: books
  // without page_count or duration_minutes can't be bucketed and drop
  // out of any non-Any length filter (deliberate — a 'short evening'
  // query shouldn't surface a book of unknown length). Status
  // exclusion: books marked 'reading' or 'finished' are silently
  // dropped — the user can't 'pick' a book they're already reading or
  // already finished, even though the on_readlist flag may still be
  // sticky on those rows.
  function matchesFilter(b, timeKey, formatKey, tagSet) {
    if (b.status && b.status !== 'unread') return false;
    const bucket = TIME_BUCKETS.find(x => x.key === timeKey);
    const fmtChoice = FORMAT_PICKER.find(x => x.key === formatKey);
    if (fmtChoice.fmt && b.format !== fmtChoice.fmt) return false;
    if (bucket.key !== 'any') {
      if (b.format === 'audiobook') {
        const m = b.duration_minutes || 0;
        if (m === 0) return false;
        if (bucket.audioMinMin != null && m <= bucket.audioMinMin) return false;
        if (bucket.audioMinMax != null && m >  bucket.audioMinMax) return false;
      } else {
        const p = b.page_count || 0;
        if (p === 0) return false;
        if (bucket.pageMin != null && p <= bucket.pageMin) return false;
        if (bucket.pageMax != null && p >  bucket.pageMax) return false;
      }
    }
    if (tagSet.size > 0) {
      const bookTags = new Set((b.tags || []).filter(t => !t.virtual).map(t => t.name));
      for (const name of tagSet) if (!bookTags.has(name)) return false;
    }
    return true;
  }

  const pickerCandidates = useMemo(
    () => books.filter(b => matchesFilter(b, pickTime, pickFormat, pickTags)),
    [books, pickTime, pickFormat, pickTags],
  );

  // Per-pill availability: for each option in each group, count books
  // that would match IF that option were selected (with the other
  // groups' current selections held). The pill is dimmed when its
  // count is 0 AND it's not the currently-active option — clicking it
  // would yield zero picks, so the UI signals dead-end ahead of time.
  // Selected pills always render bright (the user has actively chosen
  // them and shouldn't see their own choice greyed out).
  const lengthCounts = useMemo(() => {
    const counts = {};
    for (const bucket of TIME_BUCKETS) {
      counts[bucket.key] = books.filter(b => matchesFilter(b, bucket.key, pickFormat, pickTags)).length;
    }
    return counts;
  }, [books, pickFormat, pickTags]);

  const formatCounts = useMemo(() => {
    const counts = {};
    for (const f of FORMAT_PICKER) {
      counts[f.key] = books.filter(b => matchesFilter(b, pickTime, f.key, pickTags)).length;
    }
    return counts;
  }, [books, pickTime, pickTags]);

  // For tags the count question is "what would happen if I added this
  // tag to the current set" (multi-select). Already-selected tags
  // would shrink to a different cohort if removed — we don't dim those
  // (removing should always work), so the count we render for them is
  // the current candidate count itself, which is always nonzero (the
  // pill is shown only because at least one book has it).
  const tagAvailability = useMemo(() => {
    const out = new Map();
    for (const t of topReadlistTags) {
      if (pickTags.has(t.name)) {
        out.set(t.name, pickerCandidates.length);
      } else {
        const trial = new Set([...pickTags, t.name]);
        out.set(t.name, books.filter(b => matchesFilter(b, pickTime, pickFormat, trial)).length);
      }
    }
    return out;
  }, [books, pickTime, pickFormat, pickTags, topReadlistTags, pickerCandidates.length]);

  // Final picks: shuffle deterministically with shuffleSeed (so
  // 'Reshuffle' is reproducible across renders within a click), take
  // the first PICK_COUNT.
  const picks = useMemo(
    () => seededShuffle(pickerCandidates, shuffleSeed).slice(0, PICK_COUNT),
    [pickerCandidates, shuffleSeed],
  );

  function togglePickTag(name) {
    setPickTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Remove a stale readlist flag without leaving the page. Optimistic:
  // drop locally so the picker re-rolls immediately, then PATCH. On
  // failure restore from snapshot and surface the error — the housekeeping
  // section silently dropping rows that didn't actually clear would be a
  // worse failure mode than a banner.
  async function handleRemove(id) {
    if (removingIds.has(id)) return;
    setRemovingIds(s => new Set([...s, id]));
    const snapshot = books;
    setBooks(curr => curr.filter(b => b.id !== id));
    setError(null);
    try {
      await api.patchBook(id, { on_readlist: 0 });
    } catch {
      setBooks(snapshot);
      setError('Failed to remove from readlist.');
    } finally {
      setRemovingIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const wholeListEmpty = !loading && !error && books.length === 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="font-slab text-3xl text-parchment">Readlist</h1>
        {books.length > 0 && (
          <p className="text-xs text-neutral-600">
            {plural(books.length, 'book')} queued
          </p>
        )}
      </div>

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div role="alert" className="text-red-500 text-sm">{error}</div>
      ) : wholeListEmpty ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">No books on your readlist yet.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (
        <>
        <section aria-labelledby="readlist-picker-heading">
          <h2 id="readlist-picker-heading" className="font-slab text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Pick something to read
          </h2>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[11px] text-neutral-600 mr-1 w-14 flex-shrink-0">Length</span>
            {TIME_BUCKETS.map(b => {
              const selected = pickTime === b.key;
              const dead = lengthCounts[b.key] === 0 && !selected;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setPickTime(b.key)}
                  aria-pressed={selected}
                  aria-disabled={dead}
                  disabled={dead}
                  className={`text-[11px] px-2.5 py-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
                    selected
                      ? 'bg-oak/30 text-parchment'
                      : dead
                        ? 'bg-neutral-900 text-neutral-700 opacity-60 cursor-not-allowed'
                        : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {b.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[11px] text-neutral-600 mr-1 w-14 flex-shrink-0">Format</span>
            {FORMAT_PICKER.map(f => {
              const selected = pickFormat === f.key;
              const dead = formatCounts[f.key] === 0 && !selected;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setPickFormat(f.key)}
                  aria-pressed={selected}
                  aria-disabled={dead}
                  disabled={dead}
                  className={`text-[11px] px-2.5 py-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
                    selected
                      ? 'bg-oak/30 text-parchment'
                      : dead
                        ? 'bg-neutral-900 text-neutral-700 opacity-60 cursor-not-allowed'
                        : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {topReadlistTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <span className="text-[11px] text-neutral-600 mr-1 w-14 flex-shrink-0">Topic</span>
              {topReadlistTags.map(t => {
                const selected = pickTags.has(t.name);
                const dead = tagAvailability.get(t.name) === 0 && !selected;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => togglePickTag(t.name)}
                    aria-pressed={selected}
                    aria-disabled={dead}
                    disabled={dead}
                    className={`text-[11px] px-2.5 py-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
                      selected
                        ? 'bg-oak/30 text-parchment'
                        : dead
                          ? 'bg-neutral-900 text-neutral-700 opacity-60 cursor-not-allowed'
                          : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                    }`}
                  >
                    {t.name}
                    <span className={`ml-1 ${selected ? 'text-parchment/60' : 'text-neutral-700'}`}>{t.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {picks.length === 0 ? (
            <p className="text-sm text-neutral-600 py-8">
              Nothing on your readlist matches these constraints. Try relaxing one.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-6 items-start max-w-5xl mx-auto">
                {picks.map(book => <PickCard key={book.id} book={book} />)}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-neutral-600 max-w-5xl mx-auto">
                <span>
                  {pickerCandidates.length > PICK_COUNT
                    ? <>Showing {PICK_COUNT} of {pickerCandidates.length} matches.</>
                    : <>{plural(pickerCandidates.length, 'match', 'matches')}.</>}
                </span>
                {pickerCandidates.length > PICK_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShuffleSeed(s => (s + 1) | 0)}
                    className="text-neutral-500 hover:text-parchment transition-colors focus:outline-none focus-visible:text-parchment focus-visible:underline underline-offset-2"
                  >
                    ↻ Reshuffle
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="readlist-all-heading" className="mt-12">
          <h2 id="readlist-all-heading" className="font-slab text-xs text-neutral-500 uppercase tracking-wider mb-3">
            All on readlist <span className="text-neutral-700 normal-case tracking-normal ml-1">({books.length})</span>
          </h2>
          <ul className="divide-y divide-binding/15">
            {(showAllQueue ? books : books.slice(0, QUEUE_PREVIEW)).map(b => {
              const removing = removingIds.has(b.id);
              return (
                <li key={b.id} className="group flex items-center gap-3 py-2">
                  <Link
                    to={`/books/${b.id}`}
                    state={FROM_READLIST}
                    className="flex items-center gap-3 flex-1 min-w-0 focus:outline-none focus-visible:underline underline-offset-2"
                  >
                    <div className="w-8 h-12 flex-shrink-0 bg-neutral-800 rounded overflow-hidden ring-1 ring-binding/25">
                      {b.cover_path ? (
                        <img src={b.cover_path} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-neutral-500">
                          {initialsFor(b.title)}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-parchment group-hover:text-leather transition-colors truncate">{b.title}</p>
                      <p className="text-xs text-neutral-500 truncate">
                        {[formatAuthors(b.authors), lengthLabel(b)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleRemove(b.id)}
                    disabled={removing}
                    aria-label={`Remove ${b.title} from readlist`}
                    title="Remove from readlist"
                    className="text-neutral-700 hover:text-warn focus:text-warn focus:outline-none transition-colors disabled:opacity-30 flex-shrink-0 px-2 py-1 text-sm"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          {books.length > QUEUE_PREVIEW && (
            <div className="mt-3 text-xs">
              <button
                type="button"
                onClick={() => setShowAllQueue(v => !v)}
                aria-expanded={showAllQueue}
                className="text-neutral-500 hover:text-parchment transition-colors focus:outline-none focus-visible:text-parchment focus-visible:underline underline-offset-2"
              >
                {showAllQueue
                  ? `Show fewer ↑`
                  : `Show all ${books.length} →`}
              </button>
            </div>
          )}
        </section>
        </>
      )}
    </div>
  );
}
