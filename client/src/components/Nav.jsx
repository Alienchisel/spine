import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { labelForPath } from '../utils.js';

const TODAY_VISITED_KEY = 'today-visited';

function todayStr() {
  return new Date().toLocaleDateString('en-CA');  // local YYYY-MM-DD
}

export default function Nav() {
  const { pathname, search } = useLocation();
  // `+ Add book` is always visible — it used to gate on Library / Browse
  // only, but discoverability suffered (users on Stats, Author, Loved
  // pages had to nav back to /. before they could add). Other surfaces
  // get the same one-tap-away affordance.
  const onReadlist = pathname === '/readlist';
  const onLoved = pathname === '/loved';
  const onLists = pathname === '/lists' || pathname.startsWith('/lists/');
  const onDiary = pathname === '/diary';
  const onToday = pathname === '/today';
  const onNotes = pathname === '/notes';
  const onStats = pathname === '/stats';
  const onShelfView   = pathname === '/shelf-view';

  // "New today" dot beside the Today link. Shown whenever the user
  // hasn't landed on /today yet this calendar day. The suppression-
  // while-on-page check requires both pathname === '/today' AND no
  // query params — landing on /today?date=2026-06-01 (a past-date
  // view) shouldn't dismiss the dot since the user hasn't actually
  // checked today's card, and Today.jsx only writes the visited
  // breadcrumb on the current-day view. Without the search check the
  // dot would falsely vanish on bookmark loads of past dates.
  //
  // Cross-device sync: source of truth lives in the server `settings`
  // table (key 'today-visited'). localStorage is kept as a synchronous
  // cache so first paint doesn't flash a stale dot; the server fetch
  // overrides it. Triggers: every route change, plus visibilitychange
  // so coming back to the PC tab after visiting Today on the phone
  // refreshes the dot without needing a navigation.
  const onTodayCurrent = pathname === '/today' && !search;
  const [visitedTodayStr, setVisitedTodayStr] = useState(() => {
    try { return localStorage.getItem(TODAY_VISITED_KEY); } catch { return null; }
  });

  useEffect(() => {
    let cancelled = false;
    function sync() {
      fetch('/api/settings')
        .then(r => r.json())
        .then(s => {
          if (cancelled) return;
          const v = s?.[TODAY_VISITED_KEY] ?? null;
          if (!v) return;
          try { localStorage.setItem(TODAY_VISITED_KEY, v); } catch {}
          setVisitedTodayStr(v);
        })
        .catch(() => {});
    }
    sync();
    function onVisibility() {
      if (document.visibilityState === 'visible') sync();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pathname]);

  const showTodayDot = !onTodayCurrent && visitedTodayStr !== todayStr();

  // Inactive hover shifts toward the link's own active hue (one shade
  // brighter than active) instead of the previous uniform neutral-200,
  // so each surface previews its identity colour on hover.
  function navLink(to, label, active, activeColor = 'text-sky-400', hoverColor = 'hover:text-sky-300', dot = false) {
    return (
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={`text-sm transition-colors relative ${active ? activeColor : `text-neutral-500 ${hoverColor}`}`}
      >
        {label}
        {dot && (
          <span
            aria-label="New today"
            className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-teal-400"
          />
        )}
      </Link>
    );
  }

  return (
    // Header is transparent at the gutter edges so the atmosphere art
    // extends to the top of the viewport — the opaque bg + border + blur
    // sit only on the centred max-w-7xl band where the Nav contents live
    // and where page content scrolls under the sticky header.
    <header className="sticky top-0 z-50">
      {/* Skip-to-content link — sr-only by default; the focus-visible
          override pops it onto the page when a keyboard user lands on
          it as the first tab stop. Targets <main id="main"> in App.jsx
          so Enter jumps past the nav and "+ Add book" button straight
          to the page content. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-md focus:bg-oak focus:text-neutral-950 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between border-b border-neutral-800/60 bg-neutral-950/90 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="font-slab text-xl tracking-wider text-parchment hover:text-leather transition-colors uppercase flex items-baseline gap-1.5"
          >
            Spine
            <span className="text-[10px] tracking-normal text-neutral-700 font-normal normal-case">v{__APP_VERSION__}</span>
          </Link>
          <nav className="flex items-center gap-5">
            {/* Today leads the nav (1.232+) — it's the only reflective
                / ritual surface in the row, the natural entry point on
                first-open, and leftmost matches the daily-first reading
                order. The rest are utility tabs; each carries its own
                identity colour (cool tones for curation/analytical,
                warm tones for theme-aligned). */}
            {navLink('/today',      'Today',    onToday,     'text-teal-400',    'hover:text-teal-300', showTodayDot)}
            {navLink('/readlist',   'Readlist', onReadlist,  'text-sky-400',     'hover:text-sky-300')}
            {navLink('/lists',      'Lists',    onLists,     'text-emerald-400', 'hover:text-emerald-300')}
            {navLink('/loved',      'Loved',    onLoved,     'text-rose-400',    'hover:text-rose-300')}
            {navLink('/diary',      'Diary',    onDiary,     'text-amber-400',   'hover:text-amber-300')}
            {navLink('/notes',      'Notes',    onNotes,     'text-leather',     'hover:text-parchment')}
            {navLink('/stats',      'Stats',    onStats,     'text-violet-400',  'hover:text-violet-300')}
            {navLink('/shelf-view', 'Shelves',  onShelfView, 'text-oak',         'hover:text-leather')}
          </nav>
        </div>
        <Link
          to="/books/new"
          state={{ from: labelForPath(pathname), fromPath: pathname + search }}
          aria-label="Add book"
          className="text-sm font-medium bg-oak hover:bg-leather motion-safe:active:scale-[0.98] text-neutral-950 px-4 py-1.5 rounded-full whitespace-nowrap transition-[transform,background-color] ease-out duration-150"
        >
          <span aria-hidden="true">+</span>
          <span className="hidden sm:inline ml-1">Add book</span>
        </Link>
      </div>
    </header>
  );
}
