import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { nrm } from '../utils.js';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import PageHeading from '../components/PageHeading.jsx';

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

  // Loved toggle per row — single boolean, optimistic flip with
  // rollback on failure. Mirrors the books-side BookCard tray heart.
  const [loveBusy, setLoveBusy] = useState(null);
  const [loveError, setLoveError] = useState(null);

  async function toggleLoved(s) {
    if (loveBusy != null) return;
    setLoveBusy(s.name);
    setLoveError(null);
    const prev = !!s.loved;
    const next = !prev;
    setSeries(p => p.map(x => x.name === s.name ? { ...x, loved: next ? 1 : 0 } : x));
    try {
      await api.patchSeriesLoved(s.name, next);
    } catch {
      setLoveError('Failed to update loved.');
      setSeries(p => p.map(x => x.name === s.name ? { ...x, loved: prev ? 1 : 0 } : x));
    } finally {
      setLoveBusy(null);
    }
  }

  const totals = useMemo(() => ({
    total: series.length,
    books: series.reduce((acc, s) => acc + s.book_count, 0),
  }), [series]);

  const filtered = useMemo(() => {
    // nrm() folds diacritics so the filter behaves the same as the
    // CommandPalette's server-side search (e.g. "loeb" matches
    // "Loeb Classical Library"). Same shape as AuthorsIndex / TagsIndex.
    const q = nrm(query.trim());
    const rows = q
      ? series.filter(s => nrm(s.name).includes(q))
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
        <PageHeading>Series</PageHeading>
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

      {loveError && (
        <p role="alert" className="text-xs text-warn mb-3">{loveError}</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-600 border-b border-neutral-800/60">
            <tr>
              <th className="text-center py-2 w-8" title="Loved"></th>
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
              const isLoved = !!s.loved;
              const heartTitle = isLoved ? 'Remove from loved' : 'Mark as loved';
              return (
                <tr key={s.name} className="border-b border-neutral-900 hover:bg-neutral-900/50 transition-colors">
                  <td className="text-center py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleLoved(s)}
                      disabled={loveBusy === s.name}
                      title={heartTitle}
                      aria-label={`${heartTitle}: ${s.name}`}
                      aria-pressed={isLoved}
                      className={`transition-colors disabled:opacity-60 ${isLoved ? 'text-red-400 hover:text-red-300' : 'text-neutral-700 hover:text-neutral-400'}`}
                    >
                      <span className="leading-none">{isLoved ? '♥' : '♡'}</span>
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
      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-neutral-500 mt-4">No series match the current filters.</p>
      )}
    </div>
  );
}
