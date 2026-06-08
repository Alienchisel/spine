import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import SwapShowcaseModal from '../components/SwapShowcaseModal.jsx';

// Sort modes for the Series index. Name is the default alphabetical
// scan. Books desc shows the biggest series first (the natural overview
// flow). Recent activity sorts by most-recent publication year, useful
// for finding series with new entries since you last bought one.
const SORTS = [
  { key: 'name',       label: 'Name' },
  { key: 'books_desc', label: 'Books, most first' },
  { key: 'books_asc',  label: 'Books, fewest first' },
  { key: 'recent',     label: 'Most recent activity' },
];
const VALID_SORTS = new Set(SORTS.map(s => s.key));

const VALID_PARAMS = new Set(['q', 'sort']);
function pickValidParams(src) {
  const out = new URLSearchParams();
  for (const [k, v] of src.entries()) {
    if (VALID_PARAMS.has(k)) out.set(k, v);
  }
  return out;
}

// "1990" / "1990–2013" / null. Falsy on both ends → null so the cell
// can render an em-dash placeholder.
function yearRange(first, last) {
  if (!first && !last) return null;
  if (first && last && first !== last) return `${first}–${last}`;
  return String(first ?? last);
}

// "1" / "1–10" / "0.5–3" — trims trailing .0 on whole-number numbers so
// "1.0" displays as "1". Half-volumes (0.5, 1.5) keep their decimal.
function num(n) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : String(n);
}
function numberRange(min, max) {
  if (min == null && max == null) return null;
  if (min == null) return num(max);
  if (max == null) return num(min);
  if (min === max) return num(min);
  return `${num(min)}–${num(max)}`;
}

export default function SeriesIndex() {
  const [series,  setSeries]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [params, setParams]   = useSearchParams();
  const { pathname, search, state }  = useLocation();
  // Back-link contract — '← Series' on BrowsePage returns to the current
  // filter+sort view, not the Library default.
  const fromState = { from: 'Series', fromPath: pathname + search };
  const query = params.get('q') ?? '';
  const sort  = VALID_SORTS.has(params.get('sort')) ? params.get('sort') : 'name';

  useEffect(() => {
    if (Array.from(params.keys()).some(k => !VALID_PARAMS.has(k))) {
      setParams(pickValidParams(params), { replace: true, state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateParam(key, value) {
    const next = pickValidParams(params);
    if (value === '' || value == null) next.delete(key);
    else                                next.set(key, String(value));
    setParams(next, { replace: true, state });
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getSeries()
      .then(setSeries)
      .catch(() => setError('Failed to load series.'))
      .finally(() => setLoading(false));
  }, []);

  // Showcase row of series — the up-to-five hand-ranked picks that
  // surface on /showcase. Used by the ★ column to render the right
  // state per row without firing a PATCH first. The list response
  // already carries showcase_position per series, so this side-fetch
  // exists only to inform the "next empty slot" computation and the
  // swap modal's contents (which need cover_path, which the list path
  // doesn't return). Failure is silent — the column falls back to its
  // disabled-add appearance.
  const [showcasePicks, setShowcasePicks] = useState([]);
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [showcaseError, setShowcaseError] = useState(null);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [pendingSeries, setPendingSeries] = useState(null);

  useEffect(() => {
    api.getSeries({ showcase: 1 })
      .then(rows => setShowcasePicks(Array.isArray(rows) ? rows : []))
      .catch(() => { /* silent */ });
  }, []);

  function updateLocal(seriesName, nextSlot) {
    setSeries(prev => prev.map(s => s.name === seriesName ? { ...s, showcase_position: nextSlot } : s));
    setShowcasePicks(prev => {
      const without = prev.filter(p => p.name !== seriesName);
      if (nextSlot == null) return without;
      const incoming = series.find(s => s.name === seriesName);
      return [...without, {
        name: seriesName,
        showcase_position: nextSlot,
        book_count: incoming?.book_count ?? 0,
        cover_path: null, // refreshed on next refetch; null is fine for state computation
      }].sort((a, b) => a.showcase_position - b.showcase_position);
    });
  }

  async function toggleShowcase(s) {
    if (showcaseBusy) return;
    setShowcaseBusy(true);
    setShowcaseError(null);
    try {
      let nextPosition;
      if (s.showcase_position) {
        nextPosition = null;
      } else {
        const taken = new Set(showcasePicks.map(p => p.showcase_position));
        nextPosition = [1, 2, 3, 4, 5].find(n => !taken.has(n));
        if (nextPosition == null) {
          setPendingSeries(s.name);
          setSwapModalOpen(true);
          setShowcaseBusy(false);
          return;
        }
      }
      await api.patchSeriesShowcase(s.name, nextPosition);
      updateLocal(s.name, nextPosition);
    } catch {
      setShowcaseError('Failed to update Showcase.');
    } finally {
      setShowcaseBusy(false);
    }
  }

  async function swapShowcasePick(pickToReplace) {
    const target = pendingSeries;
    if (!target) return;
    const freedSlot = pickToReplace.showcase_position;
    try {
      await api.patchSeriesShowcase(pickToReplace.name, null);
      await api.patchSeriesShowcase(target, freedSlot);
      updateLocal(pickToReplace.name, null);
      updateLocal(target, freedSlot);
      setSwapModalOpen(false);
      setPendingSeries(null);
      setShowcaseError(null);
    } catch {
      setShowcaseError('Failed to swap Showcase pick.');
      // Recovery — refetch so local state matches disk after a partial write.
      try {
        const rows = await api.getSeries({ showcase: 1 });
        setShowcasePicks(Array.isArray(rows) ? rows : []);
        const list = await api.getSeries();
        setSeries(Array.isArray(list) ? list : []);
      } catch { /* silent */ }
    }
  }

  const totals = useMemo(() => ({
    total: series.length,
    books: series.reduce((acc, s) => acc + s.book_count, 0),
  }), [series]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? series.filter(s => s.name.toLowerCase().includes(q))
      : series.slice();
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    switch (sort) {
      case 'books_desc': rows.sort((a, b) => b.book_count - a.book_count || byName(a, b)); break;
      case 'books_asc':  rows.sort((a, b) => a.book_count - b.book_count || byName(a, b)); break;
      case 'recent':     rows.sort((a, b) => (b.last_year ?? -Infinity) - (a.last_year ?? -Infinity) || byName(a, b)); break;
      default:           rows.sort(byName);
    }
    return rows;
  }, [series, query, sort]);

  const missing = <span className="text-oak/50">—</span>;

  return (
    <div className="max-w-4xl">
      <IncomingBackLink />
      <header className="mb-6">
        <h1 className="text-2xl font-slab text-parchment uppercase tracking-wider">Series</h1>
        {!loading && !error && (
          <p className="text-xs text-neutral-600 mt-2">
            {totals.total} series · {totals.books} books across them
          </p>
        )}
      </header>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={(e) => updateParam('q', e.target.value)}
          placeholder="Filter by name"
          aria-label="Filter series by name"
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 w-72"
        />
        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value === 'name' ? null : e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20"
          aria-label="Sort"
        >
          {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {loading && <p role="status" className="text-sm text-neutral-500">Loading…</p>}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}

      {showcaseError && (
        <p role="alert" className="text-xs text-warn mb-3">{showcaseError}</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-600 border-b border-neutral-800/60">
            <tr>
              <th className="text-center py-2 w-8" title="Showcase pick"></th>
              <th className="text-left  py-2 pr-3">Name</th>
              <th className="text-right py-2 px-3 w-20">Books</th>
              <th className="text-left  py-2 px-3 w-28" title="Range of series_number values across owned/known entries">#</th>
              <th className="text-left  py-2 px-3 w-32" title="Publication year range">Years</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const nrange = numberRange(s.min_number, s.max_number);
              const yrange = yearRange(s.first_year, s.last_year);
              const isPick  = !!s.showcase_position;
              const rowFull = !isPick && showcasePicks.length >= 5;
              const starTitle = isPick
                ? `In Showcase — rank #${s.showcase_position}. Click to remove.`
                : rowFull
                  ? 'Showcase full — click to swap in'
                  : 'Add to Showcase';
              return (
                <tr key={s.name} className="border-b border-neutral-900 hover:bg-neutral-900/50 transition-colors">
                  <td className="text-center py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleShowcase(s)}
                      disabled={showcaseBusy}
                      title={starTitle}
                      aria-label={`${starTitle}: ${s.name}`}
                      aria-pressed={isPick}
                      className={`transition-colors disabled:opacity-60 ${isPick ? 'text-indigo-400' : 'text-neutral-700 hover:text-neutral-400'}`}
                    >
                      <span className="leading-none">{isPick ? '★' : '☆'}</span>
                    </button>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Link to={`/browse/series/${encodeURIComponent(s.name)}`} state={fromState} className="text-neutral-300 hover:text-parchment transition-colors">
                      {s.name}
                    </Link>
                  </td>
                  <td className="text-right py-1.5 px-3 text-neutral-500 tabular-nums">{s.book_count}</td>
                  <td className="py-1.5 px-3 text-neutral-500 tabular-nums">{nrange ?? missing}</td>
                  <td className="py-1.5 px-3 text-neutral-500 tabular-nums">{yrange ?? missing}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <SwapShowcaseModal
        open={swapModalOpen}
        picks={showcasePicks.map(p => ({ id: p.name, label: p.name, image_path: p.cover_path, showcase_position: p.showcase_position }))}
        incomingTitle={pendingSeries ?? ''}
        onPick={(item) => swapShowcasePick(showcasePicks.find(p => p.name === item.id))}
        onClose={() => { setSwapModalOpen(false); setPendingSeries(null); }}
      />
      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-neutral-500 mt-4">No series match the current filters.</p>
      )}
    </div>
  );
}
