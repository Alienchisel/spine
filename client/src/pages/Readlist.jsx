import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatAuthors, initialsFor, fmtHM, plural, pluralWord, FORMAT_LABEL } from '../utils.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GridSkeleton } from '../components/Skeleton.jsx';

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
// audio, empty string when neither is known so .filter(Boolean) in the
// caller drops it (renders "Author" alone, not "Author · —").
function lengthLabel(book) {
  if (book.format === 'audiobook') {
    return book.duration_minutes ? fmtHM(book.duration_minutes) : '';
  }
  return book.page_count ? `${book.page_count} ${pluralWord(book.page_count, 'page')}` : '';
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
  const queryClient = useQueryClient();
  const booksQ = useQuery({
    queryKey: ['readlist'],
    queryFn: () => api.getReadlist(),
    placeholderData: (prev) => prev ?? [],
  });
  const books     = booksQ.data ?? [];
  const loading   = booksQ.isPending;
  const loadError = booksQ.error;
  const refetch   = booksQ.refetch;
  const setLoadError = () => { booksQ.refetch(); };
  const setBooks = (updater) => {
    queryClient.setQueryData(
      ['readlist'],
      (prev) => (typeof updater === 'function' ? updater(prev ?? []) : updater),
    );
  };
  // Action errors (failed remove) share the same UI slot as the load
  // error — the original implementation overloaded `setError` for both.
  // Keep them as separate state so the hook's load error doesn't carry
  // the wrong message after a refetch; merge for display.
  const [actionError, setActionError] = useState(null);
  const errorMessage = actionError ?? (loadError ? 'Failed to load readlist.' : null);
  // Picker constraint state — transient, not URL-persisted, doesn't
  // outlive the session. The picker is for "what should I pick right
  // now?", a moment-bound question.
  const [pickTime, setPickTime] = useState('any');
  const [pickFormat, setPickFormat] = useState('any');
  const [pickTags, setPickTags] = useState(() => new Set());
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const [showAllQueue, setShowAllQueue] = useState(false);
  // Format filter on the bottom housekeeping list — independent of the
  // picker's `pickFormat` above (which serves a different mode: matching
  // the next-thing-to-read constraint, not surveying the queue).
  const [queueFormat, setQueueFormat] = useState(null);

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

  // Prune pickTags down to the chips actually rendered. Without this,
  // removing the last book carrying a selected tag drops the chip from
  // topReadlistTags (so the user can't see or unset it) but leaves the
  // filter active — the picker silently returns zero matches with no
  // visible cause. The size-check guards against an unnecessary state
  // update when the set is already a subset.
  useEffect(() => {
    const valid = new Set(topReadlistTags.map(t => t.name));
    setPickTags(prev => {
      const next = new Set([...prev].filter(name => valid.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [topReadlistTags]);

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

  // Final picks: kept as an ID list in state so book mutations (most
  // notably ✕-removals from the housekeeping list below) don't trigger
  // a reshuffle of the visible covers — a derived useMemo on
  // pickerCandidates would re-roll all 10 every time one row went away,
  // which is disorienting when the user only meant to prune one row.
  //
  // The two effects keep this honest:
  //   - Pool-change effect: when pickerCandidates shifts (refetch,
  //     ✕-remove, refresh tick), only reshuffle if zero current picks
  //     survived the change. Otherwise the surviving picks stay in
  //     place and the dropped one simply disappears.
  //   - Filter/seed effect: pickTime/pickFormat/pickTags or shuffleSeed
  //     changes are *explicit* user intent — always reshuffle.
  const [pickedIds, setPickedIds] = useState([]);

  useEffect(() => {
    setPickedIds(prev => {
      const candidateIds = new Set(pickerCandidates.map(b => b.id));
      const liveCount = prev.filter(id => candidateIds.has(id)).length;
      if (liveCount > 0) return prev;
      return seededShuffle(pickerCandidates, shuffleSeed).slice(0, PICK_COUNT).map(b => b.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerCandidates]);

  useEffect(() => {
    setPickedIds(seededShuffle(pickerCandidates, shuffleSeed).slice(0, PICK_COUNT).map(b => b.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffleSeed, pickTime, pickFormat, pickTags]);

  const picks = useMemo(() => {
    const byId = new Map(pickerCandidates.map(b => [b.id, b]));
    return pickedIds.map(id => byId.get(id)).filter(Boolean);
  }, [pickedIds, pickerCandidates]);

  function togglePickTag(name) {
    setPickTags(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Remove a stale readlist flag without leaving the page. Optimistic:
  // drop locally so the picker reflects the prune immediately, then PATCH.
  // On failure refetch the readlist as the recovery path — a closure
  // snapshot would undo any concurrent ✕-removals that succeeded in the
  // meantime, replacing them on screen.
  async function handleRemove(id) {
    if (removingIds.has(id)) return;
    setRemovingIds(s => new Set([...s, id]));
    setBooks(curr => curr.filter(b => b.id !== id));
    setActionError(null);
    // Dismiss any lingering load error too — the user has moved on.
    setLoadError(null);
    try {
      await api.patchBook(id, { on_readlist: 0 });
    } catch {
      setActionError('Failed to remove from readlist.');
      refetch();
    } finally {
      setRemovingIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const wholeListEmpty = !loading && !errorMessage && books.length === 0;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="font-slab text-3xl text-parchment">Readlist</h1>
        {books.length > 0 && (
          <p className="text-xs text-neutral-600">
            {plural(books.length, 'book')} queued
          </p>
        )}
      </div>

      {loading ? (
        <GridSkeleton count={10} gridClassName="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-6 items-start" />
      ) : errorMessage ? (
        <div role="alert" className="text-warn text-sm">{errorMessage}</div>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-6 items-start">
                {picks.map(book => <PickCard key={book.id} book={book} />)}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-neutral-600">
                <span>
                  {/* Use picks.length, not PICK_COUNT, so the count
                      tracks reality after a ✕-remove drops one of the
                      visible picks (pool-change effect preserves the
                      surviving picks rather than re-rolling, which can
                      leave fewer than PICK_COUNT in `picks`). */}
                  {pickerCandidates.length > PICK_COUNT
                    ? <>Showing {picks.length} of {pickerCandidates.length} matches.</>
                    : <>{plural(pickerCandidates.length, 'match', 'matches')}.</>}
                </span>
                {pickerCandidates.length > 1 && (
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
            All on readlist
          </h2>
          {(() => {
            const availableFormats = Array.from(new Set(books.map(b => b.format).filter(Boolean))).sort();
            if (availableFormats.length <= 1) return null;
            return (
              <div className="mb-3 flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setQueueFormat(null)}
                  aria-pressed={queueFormat == null}
                  className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                    queueFormat == null
                      ? 'bg-binding/50 text-parchment border-binding/70'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                  }`}
                >
                  All formats
                </button>
                {availableFormats.map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setQueueFormat(queueFormat === f ? null : f)}
                    aria-pressed={queueFormat === f}
                    className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                      queueFormat === f
                        ? 'bg-binding/50 text-parchment border-binding/70'
                        : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {FORMAT_LABEL[f] ?? f}
                  </button>
                ))}
              </div>
            );
          })()}
          {(() => {
            const filtered = queueFormat ? books.filter(b => b.format === queueFormat) : books;
            const visible  = showAllQueue ? filtered : filtered.slice(0, QUEUE_PREVIEW);
            return (
              <>
          <ul className="divide-y divide-binding/15">
            {visible.map(b => {
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
          {filtered.length > QUEUE_PREVIEW && (
            <div className="mt-3 text-xs">
              <button
                type="button"
                onClick={() => setShowAllQueue(v => !v)}
                aria-expanded={showAllQueue}
                className="text-neutral-500 hover:text-parchment transition-colors focus:outline-none focus-visible:text-parchment focus-visible:underline underline-offset-2"
              >
                {showAllQueue
                  ? `Show fewer ↑`
                  : `Show all ${filtered.length} →`}
              </button>
            </div>
          )}
              </>
            );
          })()}
        </section>
        </>
      )}
    </div>
  );
}
