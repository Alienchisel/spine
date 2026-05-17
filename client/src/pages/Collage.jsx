import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

// Last.fm-style reading-collage grid. Three knobs (mode / period /
// size) round-trip through the URL so a chosen configuration is
// bookmarkable and shareable — a screenshot of a permalink is a
// no-build-cost "share" mechanic until PNG export lands in v2.
const MODE_OPTIONS = [
  { key: 'top_books',         label: 'Top books' },
  { key: 'top_authors',       label: 'Top authors' },
  { key: 'recently_finished', label: 'Recently finished' },
];
const PERIOD_OPTIONS = [
  { key: '7d',   label: 'Last 7 days' },
  { key: '30d',  label: 'Last 30 days' },
  { key: '90d',  label: 'Last 90 days' },
  { key: '180d', label: 'Last 6 months' },
  { key: '365d', label: 'Last year' },
  { key: 'all',  label: 'All time' },
];
const SIZE_OPTIONS = [2, 3, 4, 5];

export default function Collage() {
  const [params, setParams] = useSearchParams();
  const mode    = MODE_OPTIONS.some(m => m.key === params.get('mode'))     ? params.get('mode')     : 'top_books';
  const period  = PERIOD_OPTIONS.some(p => p.key === params.get('period')) ? params.get('period')   : '30d';
  const size    = SIZE_OPTIONS.includes(Number(params.get('size')))        ? Number(params.get('size')) : 3;
  const showLabels = params.get('labels') !== '0'; // default on; user can turn off via URL
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadGuard = useStaleGuard();

  useEffect(() => {
    const epoch = loadGuard.next();
    setLoading(true);
    api.getCollage({ mode, period, size })
      .then(d => {
        if (!loadGuard.isFresh(epoch)) return;
        setData(d);
        setError(null);
      })
      .catch(() => {
        if (!loadGuard.isFresh(epoch)) return;
        setError('Failed to load collage.');
      })
      .finally(() => { if (loadGuard.isFresh(epoch)) setLoading(false); });
  }, [mode, period, size]);

  function update(key, value) {
    const next = new URLSearchParams(params);
    next.set(key, String(value));
    setParams(next, { replace: true });
  }

  // 2-5 → matching grid template. We can't use Tailwind's dynamic
  // class names (`grid-cols-${size}`) because the scanner doesn't see
  // them; an inline style is the no-config fix.
  const gridStyle = { gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` };
  const tiles = data?.tiles ?? [];
  const blanks = Math.max(0, size * size - tiles.length);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-6">Reading collage</h1>

      <div className="mb-6 flex flex-wrap items-center gap-4 text-xs">
        <label className="inline-flex items-center gap-1.5 text-neutral-500">
          <span>Mode:</span>
          <select
            value={mode}
            onChange={(e) => update('mode', e.target.value)}
            className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 cursor-pointer transition-colors"
            aria-label="Collage mode"
          >
            {MODE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-neutral-500">
          <span>Period:</span>
          <select
            value={period}
            onChange={(e) => update('period', e.target.value)}
            className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 cursor-pointer transition-colors"
            aria-label="Collage period"
          >
            {PERIOD_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-neutral-500">
          <span>Size:</span>
          <select
            value={size}
            onChange={(e) => update('size', e.target.value)}
            className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 cursor-pointer transition-colors"
            aria-label="Grid size"
          >
            {SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}×{n}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 text-neutral-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => update('labels', e.target.checked ? '1' : '0')}
            className="accent-oak"
          />
          <span>Labels</span>
        </label>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : tiles.length === 0 ? (
        <p className="text-sm text-neutral-600">No reading activity in this period.</p>
      ) : (
        <div className="grid gap-2" style={gridStyle}>
          {tiles.map(t => (
            <Tile key={`${t.href}-${t.id}`} tile={t} showLabel={showLabels} />
          ))}
          {/* Blank placeholders fill the grid when the data set is
              smaller than size*size — keeps the rectangle's shape so
              the user sees their actual coverage relative to the
              chosen grid. */}
          {Array.from({ length: blanks }).map((_, i) => (
            <div key={`blank-${i}`} className="aspect-[2/3] bg-neutral-900/40 rounded" />
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ tile, showLabel }) {
  return (
    <Link
      to={tile.href}
      className="group relative block aspect-[2/3] rounded overflow-hidden bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-oak/50"
      title={tile.sublabel ? `${tile.label} · ${tile.sublabel}` : tile.label}
    >
      {tile.image ? (
        <img
          src={tile.image}
          alt=""
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
        />
      ) : (
        // Skeleton fallback — matches the no-cover / no-portrait
        // shape used elsewhere. The label-overlay (if enabled) still
        // shows so the tile carries meaning.
        <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center text-neutral-700 text-3xl font-slab">
          {tile.label?.[0] ?? '·'}
        </div>
      )}
      {showLabel && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-2">
          <p className="text-xs text-neutral-100 font-medium leading-tight line-clamp-2">{tile.label}</p>
          {tile.sublabel && (
            <p className="text-[10px] text-neutral-400 mt-0.5">{tile.sublabel}</p>
          )}
        </div>
      )}
    </Link>
  );
}
