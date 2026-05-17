import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { api } from '../api.js';
import { initialsFor } from '../utils.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

const STORAGE_KEY = 'spine.collage.lastConfig';

// Last.fm-style reading-collage grid. URL knobs (mode / period / size /
// series / year / labels) round-trip so a chosen view is bookmarkable.
// PNG export captures the framed grid + footer at the dark Spine palette.
const MODE_OPTIONS = [
  { key: 'top_books',         label: 'Top books' },
  { key: 'top_authors',       label: 'Top authors' },
  { key: 'recently_finished', label: 'Recently finished' },
  { key: 'series_spotlight',  label: 'Series spotlight' },
  { key: 'year_in_review',    label: 'Year in review' },
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
  const series = params.get('series') ?? '';
  // Year in review defaults to the current year if no ?year= is set —
  // matches the "what have I read this year so far" use case that
  // dominates January/early-year visits.
  const yearParam = parseInt(params.get('year'), 10);
  const year = Number.isInteger(yearParam) ? yearParam : new Date().getFullYear();

  const needsSeries = mode === 'series_spotlight';
  const needsYear   = mode === 'year_in_review';
  const usesPeriod  = !needsSeries && !needsYear;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [facets, setFacets] = useState({ series: [], years: [] });
  const loadGuard = useStaleGuard();
  // Single-flight guard on the PNG export so a double-click can't fire
  // two parallel html2canvas passes (each is heavy — ~1 MB raster).
  const exportGuard = useActionGuard();
  // Captured by html2canvas — we want the framed export region, not
  // the whole page (no nav, no controls).
  const exportRef = useRef(null);

  // localStorage persistence — restore on a bare /collage visit so the
  // user lands on their preferred config without bookmarking. Explicit
  // URL params always win; this only fills in for empty visits. Saved
  // on every params change so the most recent state is always the one
  // that survives a refresh.
  useEffect(() => {
    if (params.toString() === '') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setParams(new URLSearchParams(saved), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const s = params.toString();
    if (s) localStorage.setItem(STORAGE_KEY, s);
  }, [params]);

  function resetConfig() {
    localStorage.removeItem(STORAGE_KEY);
    setParams(new URLSearchParams(), { replace: true });
  }

  // Lazy-fetch facets on first mount. Cached for the session — a long-
  // lived tab will see stale data if the user adds/removes series or
  // logs a new year mid-session, but the cost (one-off refetch) isn't
  // worth a refresh-tick subscription.
  useEffect(() => {
    api.getCollageFacets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    // Skip the fetch when the mode needs a parameter that isn't set
    // yet — would otherwise hit the server with an inevitable 400.
    if (needsSeries && !series) { setData({ tiles: [] }); setLoading(false); return; }
    const epoch = loadGuard.next();
    setLoading(true);
    api.getCollage({
      mode, period, size, series,
      year: needsYear ? year : undefined,
    })
      .then(d => {
        if (!loadGuard.isFresh(epoch)) return;
        setData(d);
        setError(null);
      })
      .catch(err => {
        if (!loadGuard.isFresh(epoch)) return;
        setError(`Failed to load collage${err?.message ? `: ${err.message}` : '.'}`);
      })
      .finally(() => { if (loadGuard.isFresh(epoch)) setLoading(false); });
  }, [mode, period, size, series, year]);

  function update(key, value) {
    const next = new URLSearchParams(params);
    if (value === '' || value == null) next.delete(key);
    else                                next.set(key, String(value));
    setParams(next, { replace: true });
  }

  async function downloadPng() {
    if (!exportRef.current) return;
    if (!exportGuard.begin()) return;
    setError(null);
    try {
      // Custom fonts (font-slab) might not be ready at first paint;
      // html2canvas would otherwise capture the fallback metric. Wait
      // for the font registry to settle before snapshotting.
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: '#080e0d',  // bg-neutral-950
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const stamp = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
      const slug = mode + (needsSeries ? `-${series}` : '') + (needsYear ? `-${year}` : `-${period}`);
      const filename = `spine-collage-${slug.replace(/[^a-z0-9-]/gi, '_')}-${stamp}.png`;
      canvas.toBlob((blob) => {
        if (!blob) { setError('Failed to render PNG.'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (err) {
      setError(`Export failed: ${err?.message || 'unknown error'}`);
    } finally {
      exportGuard.end();
    }
  }

  // 2-5 → matching grid template. We can't use Tailwind's dynamic
  // class names (`grid-cols-${size}`) because the scanner doesn't see
  // them; an inline style is the no-config fix.
  const gridStyle = { gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` };
  const tiles = data?.tiles ?? [];
  const blanks = Math.max(0, size * size - tiles.length);
  const todayIso = new Date().toLocaleDateString('en-CA');
  // Tile links carry this state so the Book/Author page back-button
  // returns to the same Collage view the user came from (including the
  // selected mode / period / size, encoded in the URL).
  const fromState = {
    from: 'Collage',
    fromPath: `/collage${params.toString() ? `?${params.toString()}` : ''}`,
  };
  const footerStamp =
      needsSeries ? `Series · ${series || '—'}`
    : needsYear   ? `Year · ${year}`
    : (PERIOD_OPTIONS.find(p => p.key === period)?.label ?? period);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-white mb-6">Reading collage</h1>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
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
        {usesPeriod && (
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
        )}
        {needsSeries && (
          <label className="inline-flex items-center gap-1.5 text-neutral-500">
            <span>Series:</span>
            <input
              type="text"
              list="collage-series"
              value={series}
              onChange={(e) => update('series', e.target.value)}
              placeholder="Type or pick…"
              className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 placeholder-neutral-700 focus:outline-none focus:border-oak/50 transition-colors w-48"
              aria-label="Series for spotlight"
            />
            <datalist id="collage-series">
              {facets.series.map(s => <option key={s} value={s} />)}
            </datalist>
          </label>
        )}
        {needsYear && (
          <label className="inline-flex items-center gap-1.5 text-neutral-500">
            <span>Year:</span>
            <select
              value={year}
              onChange={(e) => update('year', e.target.value)}
              className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 cursor-pointer transition-colors"
              aria-label="Year to review"
            >
              {/* Ensure the current year shows in the dropdown even
                  if the facets list doesn't include it yet (e.g. user
                  hasn't logged any reading this year). */}
              {!facets.years.includes(String(year)) && (
                <option key={year} value={year}>{year}</option>
              )}
              {facets.years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        )}
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
        <button
          type="button"
          onClick={resetConfig}
          className="ml-auto text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
          title="Clear saved defaults and reset all knobs"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={downloadPng}
          disabled={exportGuard.busy || tiles.length === 0}
          className="text-xs px-3 py-1.5 rounded bg-oak text-neutral-950 font-medium hover:bg-leather disabled:opacity-50 disabled:cursor-wait transition-colors"
          title="Download a PNG of this collage"
        >
          {exportGuard.busy ? 'Rendering…' : '↓ Download PNG'}
        </button>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : tiles.length === 0 ? (
        <p className="text-sm text-neutral-600">
          {needsSeries && !series ? 'Pick a series to spotlight.'
            : needsYear ? `No reading activity logged in ${year}.`
            : 'No reading activity in this period.'}
        </p>
      ) : (
        // Captured frame — this is what html2canvas snapshots. Padding
        // gives the PNG breathing room so it doesn't read as edge-to-
        // edge.
        <div ref={exportRef} className="bg-neutral-950 text-parchment p-6 rounded">
          <div className="grid gap-2" style={gridStyle}>
            {tiles.map(t => (
              <Tile
                key={`${t.href}-${t.id}`}
                tile={t}
                showLabel={showLabels}
                linkState={fromState}
              />
            ))}
            {/* Blank placeholders fill the grid when the data set is
                smaller than size*size — keeps the rectangle's shape so
                the user sees their actual coverage relative to the
                chosen grid. */}
            {Array.from({ length: blanks }).map((_, i) => (
              <div key={`blank-${i}`} className="aspect-[2/3] bg-neutral-900/40 rounded" />
            ))}
          </div>
          {/* Footer is the attribution stamp on the exported PNG so
              shared screenshots aren't anonymous. Visible on-page too
              as part of the captured layout. */}
          <p className="mt-4 text-[10px] text-neutral-700 text-right tracking-wide">
            spine · {footerStamp} · {todayIso}
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ tile, showLabel, linkState }) {
  return (
    <Link
      to={tile.href}
      state={linkState}
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
        // Skeleton fallback — initials carry more meaning than a single
        // letter, especially on author tiles where ~30% of portraits
        // are missing ("OB" reads as Octavia Butler much more clearly
        // than "O"). Capped at 3 chars so longer names stay legible at
        // tile size. Mononyms ("Plato") fall through as one letter.
        <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center text-neutral-700 text-3xl font-slab tracking-wide">
          {initialsFor(tile.label)}
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
