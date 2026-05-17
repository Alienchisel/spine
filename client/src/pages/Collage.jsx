import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { api } from '../api.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

// Last.fm-style reading-collage grid. Four URL knobs (mode / period /
// size / title) round-trip so a configured view is bookmarkable. v2
// adds a one-click PNG export of just the framed grid + title + footer
// — useful for sharing without a manual screenshot.
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
  const title  = params.get('title') ?? '';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const loadGuard = useStaleGuard();
  // Single-flight guard on the PNG export so a double-click can't fire
  // two parallel html2canvas passes (each is heavy — ~1 MB raster).
  const exportGuard = useActionGuard();
  // Captured by html2canvas — we want the framed export region, not
  // the whole page (no nav, no controls).
  const exportRef = useRef(null);

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
        backgroundColor: '#0a0a0a',  // bg-neutral-950
        scale: 2,                    // retina-crisp
        useCORS: true,
        logging: false,
      });
      const stamp = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
      const filename = `spine-collage-${mode}-${period}-${stamp}.png`;
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
  const periodLabel = PERIOD_OPTIONS.find(p => p.key === period)?.label ?? period;
  const todayIso    = new Date().toLocaleDateString('en-CA');

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
        <button
          type="button"
          onClick={downloadPng}
          disabled={exportGuard.busy || tiles.length === 0}
          className="ml-auto text-xs px-3 py-1.5 rounded bg-oak text-neutral-950 font-medium hover:bg-leather disabled:opacity-50 disabled:cursor-wait transition-colors"
          title="Download a PNG of this collage"
        >
          {exportGuard.busy ? 'Rendering…' : '↓ Download PNG'}
        </button>
      </div>

      {/* Title field is below the controls so it sits closer to where
          it'll appear in the captured frame. Round-trips via the URL
          like the other knobs. */}
      <div className="mb-6 flex items-center gap-2 text-xs">
        <label className="inline-flex items-center gap-1.5 text-neutral-500 flex-1 max-w-md">
          <span className="flex-shrink-0">Title:</span>
          <input
            type="text"
            value={title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="Optional — appears on the PNG export"
            maxLength={80}
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 placeholder-neutral-700 focus:outline-none focus:border-oak/50 transition-colors"
            aria-label="Collage title"
          />
        </label>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : tiles.length === 0 ? (
        <p className="text-sm text-neutral-600">No reading activity in this period.</p>
      ) : (
        // Captured frame — this is what html2canvas snapshots. Padding
        // gives the PNG breathing room so it doesn't read as edge-to-
        // edge. bg-neutral-950 ensures the captured background matches
        // the page even if the page bg ever changes.
        <div ref={exportRef} className="bg-neutral-950 p-6 rounded">
          {title && (
            <h2 className="font-slab text-xl text-parchment mb-4 tracking-wide">{title}</h2>
          )}
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
          {/* Footer is visually subtle in the live view; it's the
              attribution stamp on the exported PNG so shared screenshots
              aren't anonymous. */}
          <p className="mt-4 text-[10px] text-neutral-700 text-right tracking-wide">
            spine · {periodLabel} · {todayIso}
          </p>
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
