import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { api } from '../api.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

// Last.fm-style reading-collage grid. URL knobs (mode / period / size /
// series / year / theme / title / labels) round-trip so a chosen view
// is bookmarkable. PNG export captures the framed grid + title +
// footer; theme switches frame background + text colors so the export
// can match the share context (dark / parchment / sepia).
const MODE_OPTIONS = [
  { key: 'top_books',         label: 'Top books' },
  { key: 'top_authors',       label: 'Top authors' },
  { key: 'recently_finished', label: 'Recently finished' },
  { key: 'series_spotlight',  label: 'Series spotlight' },
  { key: 'year_in_review',    label: 'Year in review' },
  { key: 'top_loved',         label: 'Top loved' },
  { key: 'top_rated',         label: 'Top rated' },
  { key: 'hand_curated',      label: 'Hand-curated' },
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

// Theme map. `bg`/`text`/`subText` are Tailwind classes applied to the
// captured frame; `canvasBg` is the hex html2canvas paints behind any
// transparent regions (rounded corners, gaps) so the PNG seams match.
const THEMES = {
  dark: {
    label:    'Dark',
    bg:       'bg-neutral-950',
    text:     'text-parchment',
    subText:  'text-neutral-700',
    canvasBg: '#080e0d',
    blank:    'bg-neutral-900/40',
  },
  parchment: {
    label:    'Parchment',
    bg:       'bg-parchment',
    text:     'text-neutral-900',
    subText:  'text-neutral-600',
    canvasBg: '#f6f2ea',
    blank:    'bg-neutral-200',
  },
  sepia: {
    label:    'Sepia',
    bg:       'bg-[#2a1810]',
    text:     'text-parchment',
    subText:  'text-amber-200/40',
    canvasBg: '#2a1810',
    blank:    'bg-[#3a2418]',
  },
};
const THEME_KEYS = Object.keys(THEMES);

export default function Collage() {
  const [params, setParams] = useSearchParams();
  const mode    = MODE_OPTIONS.some(m => m.key === params.get('mode'))     ? params.get('mode')     : 'top_books';
  const period  = PERIOD_OPTIONS.some(p => p.key === params.get('period')) ? params.get('period')   : '30d';
  const size    = SIZE_OPTIONS.includes(Number(params.get('size')))        ? Number(params.get('size')) : 3;
  const showLabels = params.get('labels') !== '0'; // default on; user can turn off via URL
  const title  = params.get('title') ?? '';
  const series = params.get('series') ?? '';
  const year   = parseInt(params.get('year'), 10);
  // Hand-curated book IDs: comma-separated in URL, parsed to a deduped
  // ordered array. Dedupe protects against a book getting added twice
  // by an over-eager click; order is preserved (first occurrence wins).
  const books = (params.get('books') ?? '')
    .split(',')
    .map(s => parseInt(s, 10))
    .filter(n => Number.isInteger(n) && n > 0);
  const seen = new Set();
  const orderedBooks = books.filter(id => seen.has(id) ? false : (seen.add(id), true));
  const themeKey = THEME_KEYS.includes(params.get('theme')) ? params.get('theme') : 'dark';
  const theme = THEMES[themeKey];

  const needsSeries = mode === 'series_spotlight';
  const needsYear   = mode === 'year_in_review';
  const needsBooks  = mode === 'hand_curated';
  const usesPeriod  = !needsSeries && !needsYear && !needsBooks
    && mode !== 'top_loved' && mode !== 'top_rated';

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

  // Lazy-fetch facets on first mount. Cached for the session — a long-
  // lived tab will see stale data if the user adds/removes series or
  // logs a new year mid-session, but the cost (one-off refetch) isn't
  // worth a refresh-tick subscription.
  useEffect(() => {
    api.getCollageFacets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    // Skip the fetch when the mode needs a parameter that isn't set
    // yet — would otherwise hit the server with an inevitable 400 (or
    // an empty response we already know to expect for hand_curated).
    if (needsSeries && !series) { setData({ tiles: [] }); setLoading(false); return; }
    if (needsYear   && !Number.isInteger(year)) { setData({ tiles: [] }); setLoading(false); return; }
    if (needsBooks  && orderedBooks.length === 0) { setData({ tiles: [] }); setLoading(false); return; }
    const epoch = loadGuard.next();
    setLoading(true);
    api.getCollage({
      mode, period, size, series,
      year:  Number.isInteger(year) ? year : undefined,
      books: needsBooks && orderedBooks.length ? orderedBooks.join(',') : undefined,
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
  }, [mode, period, size, series, year, params.get('books')]);

  function addBookToCuration(bookId) {
    if (orderedBooks.includes(bookId)) return;
    if (orderedBooks.length >= size * size) return; // already at cap
    const next = [...orderedBooks, bookId];
    update('books', next.join(','));
  }
  function removeBookFromCuration(bookId) {
    const next = orderedBooks.filter(id => id !== bookId);
    update('books', next.length ? next.join(',') : '');
  }
  function clearCuration() {
    update('books', '');
  }

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
        backgroundColor: theme.canvasBg,
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
  const footerStamp =
      needsSeries ? `Series · ${series || '—'}`
    : needsYear   ? `Year · ${Number.isInteger(year) ? year : '—'}`
    : needsBooks  ? 'Hand-curated'
    : mode === 'top_loved' ? 'Loved'
    : mode === 'top_rated' ? 'Top-rated'
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
              value={Number.isInteger(year) ? year : ''}
              onChange={(e) => update('year', e.target.value)}
              className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 cursor-pointer transition-colors"
              aria-label="Year to review"
            >
              <option value="" disabled>Pick a year…</option>
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
        <label className="inline-flex items-center gap-1.5 text-neutral-500">
          <span>Theme:</span>
          <select
            value={themeKey}
            onChange={(e) => update('theme', e.target.value)}
            className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 cursor-pointer transition-colors"
            aria-label="Collage theme"
          >
            {THEME_KEYS.map(k => <option key={k} value={k}>{THEMES[k].label}</option>)}
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

      {needsBooks && (
        <CurationSearch
          onPick={addBookToCuration}
          onClear={clearCuration}
          atCap={orderedBooks.length >= size * size}
          curatedCount={orderedBooks.length}
          maxCount={size * size}
        />
      )}

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : tiles.length === 0 ? (
        <p className="text-sm text-neutral-600">
          {needsSeries && !series ? 'Pick a series to spotlight.'
            : needsYear && !Number.isInteger(year) ? 'Pick a year to review.'
            : needsBooks ? 'Search to add books to your collage.'
            : mode === 'top_loved' ? 'No loved books yet.'
            : mode === 'top_rated' ? 'No books rated 4★ or higher yet.'
            : 'No reading activity in this period.'}
        </p>
      ) : (
        // Captured frame — this is what html2canvas snapshots. Padding
        // gives the PNG breathing room so it doesn't read as edge-to-
        // edge. Theme classes control bg + text so the export adopts
        // the selected aesthetic; canvasBg keeps html2canvas's seam
        // color consistent with the frame.
        <div ref={exportRef} className={`${theme.bg} ${theme.text} p-6 rounded`}>
          {title && (
            <h2 className="font-slab text-xl mb-4 tracking-wide">{title}</h2>
          )}
          <div className="grid gap-2" style={gridStyle}>
            {tiles.map(t => (
              <Tile
                key={`${t.href}-${t.id}`}
                tile={t}
                showLabel={showLabels}
                onRemove={needsBooks ? () => removeBookFromCuration(t.id) : undefined}
              />
            ))}
            {/* Blank placeholders fill the grid when the data set is
                smaller than size*size — keeps the rectangle's shape so
                the user sees their actual coverage relative to the
                chosen grid. */}
            {Array.from({ length: blanks }).map((_, i) => (
              <div key={`blank-${i}`} className={`aspect-[2/3] ${theme.blank} rounded`} />
            ))}
          </div>
          {/* Footer is the attribution stamp on the exported PNG so
              shared screenshots aren't anonymous. Visible on-page too
              as part of the captured layout. */}
          <p className={`mt-4 text-[10px] ${theme.subText} text-right tracking-wide`}>
            spine · {footerStamp} · {todayIso}
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({ tile, showLabel, onRemove }) {
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
      {onRemove && (
        // Hover-revealed remove badge for hand_curated mode. preventDefault +
        // stopPropagation so the click doesn't navigate to the book page.
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-xs leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-warn transition-opacity"
          title="Remove from collage"
          aria-label="Remove from collage"
        >
          ×
        </button>
      )}
    </Link>
  );
}

// Inline book-search dropdown for the hand-curated mode. Debounced
// 200ms against api.getBooks; result list disables when the curation
// is already at the size-cap. A "Clear all" affordance only appears
// when there's something to clear.
function CurationSearch({ onPick, onClear, atCap, curatedCount, maxCount }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const searchGuard = useStaleGuard();

  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults([]); setBusy(false); return; }
    const epoch = searchGuard.next();
    setBusy(true);
    const timer = setTimeout(() => {
      api.getBooks({ q: term, limit: 8 })
        .then(({ books }) => {
          if (!searchGuard.isFresh(epoch)) return;
          setResults(books);
        })
        .catch(() => { if (searchGuard.isFresh(epoch)) setResults([]); })
        .finally(() => { if (searchGuard.isFresh(epoch)) setBusy(false); });
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 text-xs mb-2">
        <span className="text-neutral-500">
          {curatedCount} of {maxCount} books picked
        </span>
        {curatedCount > 0 && (
          <button
            onClick={onClear}
            className="text-neutral-600 hover:text-warn transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="relative max-w-md">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={atCap ? `At cap (${maxCount}) — remove a tile to add another` : 'Search to add books…'}
          disabled={atCap}
          className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-sm text-white placeholder-neutral-600 disabled:opacity-50 focus:outline-none focus:border-oak/50"
          aria-label="Search to add books"
        />
        {busy && <p role="status" className="absolute right-3 top-1.5 text-xs text-neutral-600 pointer-events-none">…</p>}
        {results.length > 0 && !atCap && (
          <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded shadow-lg">
            {results.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => { onPick(b.id); setQuery(''); setResults([]); }}
                className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 hover:bg-neutral-800 transition-colors"
              >
                <div className="w-7 h-[42px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
                  {b.cover_path && <img src={b.cover_path} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200 truncate">{b.title}</p>
                  <p className="text-xs text-neutral-500 truncate">
                    {b.authors?.map(a => a.name).join(', ')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
