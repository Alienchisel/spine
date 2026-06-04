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
const PICK_COUNT = 6;
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
      <p className="text-xs text-parchment group-hover:text-leather transition-colors mt-2 line-clamp-2 leading-snug">
        {book.title}
      </p>
      <p className="text-[11px] text-neutral-500 mt-0.5 line-clamp-1">{meta}</p>
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

  // Books matching the picker constraints. Length filter is best-effort
  // — books without page_count or duration_minutes can't be bucketed,
  // so a non-Any length filter drops them entirely (a deliberate trade-
  // off: a 'short evening' query shouldn't surface a book whose length
  // is unknown).
  const pickerCandidates = useMemo(() => {
    const bucket = TIME_BUCKETS.find(b => b.key === pickTime);
    const fmtChoice = FORMAT_PICKER.find(f => f.key === pickFormat);
    return books.filter(b => {
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
      if (pickTags.size > 0) {
        const tags = new Set((b.tags || []).filter(t => !t.virtual).map(t => t.name));
        for (const name of pickTags) if (!tags.has(name)) return false;
      }
      return true;
    });
  }, [books, pickTime, pickFormat, pickTags]);

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
        <section aria-labelledby="readlist-picker-heading">
          <h2 id="readlist-picker-heading" className="font-slab text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Pick something to read
          </h2>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[11px] text-neutral-600 mr-1 w-14 flex-shrink-0">Length</span>
            {TIME_BUCKETS.map(b => (
              <button
                key={b.key}
                type="button"
                onClick={() => setPickTime(b.key)}
                aria-pressed={pickTime === b.key}
                className={`text-[11px] px-2.5 py-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
                  pickTime === b.key ? 'bg-oak/30 text-parchment' : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[11px] text-neutral-600 mr-1 w-14 flex-shrink-0">Format</span>
            {FORMAT_PICKER.map(f => (
              <button
                key={f.key}
                type="button"
                onClick={() => setPickFormat(f.key)}
                aria-pressed={pickFormat === f.key}
                className={`text-[11px] px-2.5 py-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
                  pickFormat === f.key ? 'bg-oak/30 text-parchment' : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {topReadlistTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <span className="text-[11px] text-neutral-600 mr-1 w-14 flex-shrink-0">Topic</span>
              {topReadlistTags.map(t => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => togglePickTag(t.name)}
                  aria-pressed={pickTags.has(t.name)}
                  className={`text-[11px] px-2.5 py-1 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-oak/40 ${
                    pickTags.has(t.name) ? 'bg-oak/30 text-parchment' : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-300'
                  }`}
                >
                  {t.name}
                  <span className="text-neutral-700 ml-1">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          {picks.length === 0 ? (
            <p className="text-sm text-neutral-600 py-8">
              Nothing on your readlist matches these constraints. Try relaxing one.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-5 items-start">
                {picks.map(book => <PickCard key={book.id} book={book} />)}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-neutral-600">
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
      )}
    </div>
  );
}
