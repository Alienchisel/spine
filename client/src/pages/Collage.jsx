import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useLocation, Link } from 'react-router-dom';
import html2canvas from 'html2canvas-pro';
import { api } from '../api.js';
import { initialsFor } from '../utils.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

const STORAGE_KEY = 'spine.collage.lastConfig';

// Last.fm-style reading-collage grid. URL knobs (mode / period / size /
// year) round-trip so a chosen view is bookmarkable. The on-page view
// is a bare grid matching every other cover-grid surface in Spine; the
// PNG export adds a dark padded frame + attribution footer via a DOM
// clone at capture time so the on-page chrome doesn't drift from the
// rest of the app.
const MODE_OPTIONS = [
  { key: 'top_books',         label: 'Top books' },
  { key: 'top_authors',       label: 'Top authors' },
  { key: 'recently_finished', label: 'Recently finished' },
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
const SIZE_OPTIONS = [3, 4, 5, 6];

// URL-param whitelist. Anything not listed gets stripped during
// localStorage restore, on mount sanitization, and on every update()
// call so stale params from removed features (theme, series, title,
// quote, labels, books, ...) can't accumulate or get re-saved.
const VALID_PARAMS = new Set(['mode', 'period', 'size', 'year', 'names']);
function pickValidParams(src) {
  const out = new URLSearchParams();
  for (const [k, v] of src.entries()) {
    if (VALID_PARAMS.has(k)) out.set(k, v);
  }
  return out;
}

export default function Collage() {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  // Back-link contract mirrors Author/BookDetail/BrowsePage: state.from
  // is the label, state.fromPath is the URL to return to. Defaults to
  // Library when arrived at /collage cold (no in-app referrer).
  const backLabel = state?.from ? `← ${state.from}` : '← Library';
  const backPath  = state?.fromPath ?? '/';
  const mode    = MODE_OPTIONS.some(m => m.key === params.get('mode'))     ? params.get('mode')     : 'top_books';
  const period  = PERIOD_OPTIONS.some(p => p.key === params.get('period')) ? params.get('period')   : '30d';
  const size    = SIZE_OPTIONS.includes(Number(params.get('size')))        ? Number(params.get('size')) : 3;
  // 'names=1' overlays the author name on each tile — useful for PNG
  // exports where the hover title="" tooltip doesn't survive. Only
  // applies to top_authors; the URL param is allowed in any mode but
  // the toggle is hidden + the overlay suppressed elsewhere.
  const namesOverlay = params.get('names') === '1';
  // Year in review defaults to the current year if no ?year= is set —
  // matches the "what have I read this year so far" use case that
  // dominates January/early-year visits.
  const yearParam = parseInt(params.get('year'), 10);
  const year = Number.isInteger(yearParam) ? yearParam : new Date().getFullYear();

  const needsYear   = mode === 'year_in_review';
  // recently_finished ignores period (always returns the N most-recent
  // finishes); year_in_review has its own year picker instead.
  const usesPeriod  = !needsYear && mode !== 'recently_finished';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [facets, setFacets] = useState({ years: [] });
  const loadGuard = useStaleGuard();
  // Single-flight guard on the PNG export so a double-click can't fire
  // two parallel html2canvas passes (each is heavy — ~1 MB raster).
  const exportGuard = useActionGuard();
  // Source for the PNG export. html2canvas snapshots a styled clone
  // of this element (see downloadPng) so the framing + footer only
  // exist in the exported image, not on the live page.
  const gridRef = useRef(null);

  // localStorage persistence + URL sanitization — restore on a bare
  // /collage visit so the user lands on their preferred config without
  // bookmarking. Explicit URL params always win; this only fills in
  // for empty visits. Both paths strip stale params from removed
  // features (theme, series, title, quote, labels, books) so a saved
  // config from an earlier Spine version doesn't carry dead state.
  useEffect(() => {
    // Preserve location.state across the replace: setSearchParams does
    // NOT carry state forward by default, so an unprotected replace
    // here wipes the { from, fromPath } that Stats / palette / etc.
    // passed in — back link silently degrades to '← Library'.
    if (params.toString() === '') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const cleaned = pickValidParams(new URLSearchParams(saved));
        if (cleaned.toString()) setParams(cleaned, { replace: true, state });
      }
    } else if (Array.from(params.keys()).some(k => !VALID_PARAMS.has(k))) {
      // URL arrived with stale params (deep-link from old bookmark).
      // Strip them so the user doesn't keep them around accidentally.
      setParams(pickValidParams(params), { replace: true, state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Save only whitelisted params so an unexpected stale value
    // (manual URL edit, dev tools) doesn't leak into localStorage.
    const cleaned = pickValidParams(params);
    const s = cleaned.toString();
    if (s) localStorage.setItem(STORAGE_KEY, s);
  }, [params]);

  function resetConfig() {
    localStorage.removeItem(STORAGE_KEY);
    setParams(new URLSearchParams(), { replace: true, state });
  }

  // Lazy-fetch facets on first mount. Cached for the session — a long-
  // lived tab will see stale data if the user logs a new year mid-
  // session, but the cost (one-off refetch) isn't worth a refresh-
  // tick subscription.
  useEffect(() => {
    api.getCollageFacets().then(setFacets).catch(() => {});
  }, []);

  useEffect(() => {
    // Skip the fetch when the mode needs a parameter that isn't set
    // yet — would otherwise hit the server with an inevitable 400.
    const epoch = loadGuard.next();
    setLoading(true);
    api.getCollage({
      mode, period, size,
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
  }, [mode, period, size, year]);

  function update(key, value) {
    // Defense-in-depth: rebuild the params from only-whitelisted keys
    // so a stale value carried over from a removed feature can't
    // survive past the next change to any knob. Pass `state` through
    // so toggling a knob doesn't wipe the incoming '← Stats' back link.
    const next = pickValidParams(params);
    if (value === '' || value == null)  next.delete(key);
    else if (VALID_PARAMS.has(key))     next.set(key, String(value));
    setParams(next, { replace: true, state });
  }

  async function downloadPng() {
    if (!gridRef.current) return;
    if (!exportGuard.begin()) return;
    setError(null);
    try {
      // Custom fonts (font-slab) might not be ready at first paint;
      // html2canvas would otherwise capture the fallback metric. Wait
      // for the font registry to settle before snapshotting.
      if (document.fonts?.ready) await document.fonts.ready;

      // Snapshot the live grid element directly — no wrapper, no
      // footer, no clone. html2canvas-pro (the maintained fork)
      // handles modern CSS — aspect-ratio, object-fit, gap — so the
      // captured tiles match what the user sees without any
      // pre-capture dimension shims.
      const canvas = await html2canvas(gridRef.current, {
        backgroundColor: '#080e0d',  // bg-neutral-950 — fills behind gaps + padding
        scale: 2,
        useCORS: true,
        logging: false,
        // Padding is added to the cloned DOM only so the captured PNG
        // gets breathing room around the grid; the live page stays
        // edge-to-edge.
        onclone: (_doc, el) => { el.style.padding = '24px'; },
      });
      const stamp = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
      const slug = mode + (needsYear ? `-${year}` : `-${period}`);
      const filename = `spine-collage-${slug.replace(/[^a-z0-9-]/gi, '_')}-${stamp}.png`;
      canvas.toBlob((blob) => {
        if (!blob) { setError('Failed to render PNG.'); return; }
        // Wrap the download step in its own try/catch — the outer
        // try doesn't catch async-callback throws, so a blocked
        // anchor click (some browser extensions / ad blockers
        // intercept programmatic downloads) would otherwise silently
        // fail and the button would reset with no signal to the user.
        let url;
        try {
          url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } catch (err) {
          setError(`Download blocked: ${err?.message || 'unknown error'}`);
        } finally {
          if (url) URL.revokeObjectURL(url);
        }
      }, 'image/png');
    } catch (err) {
      setError(`Export failed: ${err?.message || 'unknown error'}`);
    } finally {
      exportGuard.end();
    }
  }

  const tiles = data?.tiles ?? [];
  // Column count comes from the size selector for most modes; for
  // year_in_review we ignore size and pick from tile count so every
  // finished book fits in one frame. Aiming for a roughly square
  // overall shape (tiles are 2:3 portrait, so cols ≈ sqrt(N * 1.5)),
  // clamped to [3, 12] so a 3-book year doesn't render edge-to-edge
  // and a 200-book year doesn't crush the covers below recognition.
  const cols = needsYear
    ? Math.max(3, Math.min(12, Math.ceil(Math.sqrt(Math.max(tiles.length, 1) * 1.5))))
    : size;
  // We can't use Tailwind's dynamic class names (`grid-cols-${cols}`)
  // because the scanner doesn't see them; an inline style is the
  // no-config fix.
  const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  // Blank placeholders only meaningful for the fixed-size grid modes —
  // year_in_review shows exactly the books that were finished, no
  // empty cells needed.
  const blanks = needsYear ? 0 : Math.max(0, size * size - tiles.length);
  // Tile links carry this state so the Book/Author page back-button
  // returns to the same Collage view the user came from (including the
  // selected mode / period / size, encoded in the URL).
  const fromState = {
    from: 'Collage',
    fromPath: `/collage${params.toString() ? `?${params.toString()}` : ''}`,
  };

  return (
    <div className="max-w-5xl mx-auto">
      <Link to={backPath} className="text-sm text-neutral-500 hover:text-neutral-200 transition-colors">
        {backLabel}
      </Link>
      <h1 className="text-2xl font-bold text-white mt-6 mb-6">Reading collage</h1>

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
        {!needsYear && (
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
        )}
        {mode === 'top_authors' && (
          <label className="inline-flex items-center gap-1.5 text-neutral-500 cursor-pointer">
            <input
              type="checkbox"
              checked={namesOverlay}
              onChange={(e) => update('names', e.target.checked ? '1' : null)}
              className="accent-oak cursor-pointer"
            />
            <span>Show names</span>
          </label>
        )}
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
          className="text-xs px-3 py-1 rounded bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
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
          {needsYear ? `No books finished in ${year}.`
            : 'No reading activity in this period.'}
        </p>
      ) : (
        // Bare grid on-page, matching every other cover-grid surface
        // (Library, Loved, BrowsePage). The PNG export adds the dark
        // padded frame + attribution footer by cloning this node into
        // a styled off-screen wrapper at capture time.
        //
        // The caption + grid share the gridRef wrapper so the PNG
        // export captures both. Caption is only shown for top_books /
        // top_authors — the other modes telegraph their context
        // through tile content, and a label would just add chrome.
        <div ref={gridRef}>
          {(mode === 'top_books' || mode === 'top_authors') && (
            // Explainer — the ranking comes from reading_log sessions,
            // so a finished book with no logged sessions doesn't
            // appear. Activity is measured in pages; audiobook minutes
            // are converted to pages per-book via page_count /
            // duration_minutes, matching the SQL in lib/stats/collage.
            <p className="text-[11px] text-neutral-600 mb-3">
              {mode === 'top_books'
                ? 'Ranked by reading-log activity in pages — audiobook minutes are converted to pages using each book’s own page-count and total duration, so all formats compare in the same unit.'
                : 'Ranked by reading-log activity across each author’s books, counted in pages (audiobook minutes converted per book). A co-authored book contributes its full activity to every listed author, mirroring Last.fm’s artist-play semantics.'}
            </p>
          )}
          <div className="grid gap-2" style={gridStyle}>
            {tiles.map(t => (
              <Tile
                key={`${t.href}-${t.id}`}
                tile={t}
                linkState={fromState}
                showName={mode === 'top_authors' && namesOverlay}
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
        </div>
      )}
    </div>
  );
}

function Tile({ tile, linkState, showName }) {
  return (
    <Link
      to={tile.href}
      state={linkState}
      className="relative block aspect-[2/3] rounded overflow-hidden bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-oak/50"
      title={tile.sublabel ? `${tile.label} · ${tile.sublabel}` : tile.label}
    >
      {tile.image ? (
        <img
          src={tile.image}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : (
        // Skeleton fallback — mirrors BookCard's two-line shape so the
        // name is always visible on covers/portraits we don't have an
        // image for. Initials carry the visual weight; the small text
        // line carries the meaning so "AS" isn't a mystery without a
        // hover. Cap at 3 lines of name for very long titles.
        <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex flex-col items-center justify-center p-3 gap-2">
          <span className="text-3xl font-slab text-neutral-500 leading-none tracking-wide">
            {initialsFor(tile.label)}
          </span>
          <span className="text-xs text-neutral-500 font-medium leading-tight line-clamp-3 text-center">{tile.label}</span>
        </div>
      )}
      {/* Optional name overlay for top_authors — survives into the PNG
          export (which loses hover tooltips). Suppressed on the
          skeleton tiles since the name already shows there. */}
      {showName && tile.image && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent pt-7 pb-2 px-2 pointer-events-none">
          <p className="text-xs text-neutral-100 font-medium leading-tight text-center line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {tile.label}
          </p>
        </div>
      )}
    </Link>
  );
}
