import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { labelForPath } from '../utils.js';
import { dispatchSpineEvent } from '../hooks/useSpineEvent.js';

const TODAY_VISITED_KEY = 'today-visited';

function todayStr() {
  return new Date().toLocaleDateString('en-CA');  // local YYYY-MM-DD
}

// Hamburger icon — 3 lines that morph to an X via aria-state. CSS-only
// transition matches the focus-visible affordance on the button.
function MenuIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
      {open ? (
        <>
          <line x1="6"  y1="6"  x2="18" y2="18" />
          <line x1="18" y1="6"  x2="6"  y2="18" />
        </>
      ) : (
        <>
          <line x1="4"  y1="7"  x2="20" y2="7"  />
          <line x1="4"  y1="12" x2="20" y2="12" />
          <line x1="4"  y1="17" x2="20" y2="17" />
        </>
      )}
    </svg>
  );
}

// Magnifying-glass icon for the mobile search button. Same stroke
// weight as MenuIcon so the pair reads as a set in the top bar.
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.5" y2="16.5" />
    </svg>
  );
}

export default function Nav() {
  const { pathname, search } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the drawer on every route change. A tap on any drawer link
  // navigates; the close happens here automatically rather than on
  // each Link's onClick. Esc also closes (effect below).
  useEffect(() => { setMenuOpen(false); }, [pathname, search]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onKey(e) { if (e.key === 'Escape') setMenuOpen(false); }
    window.addEventListener('keydown', onKey);
    // Lock body scroll while the drawer is open so the page underneath
    // doesn't track the drawer's swipe gestures on iOS Safari.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuOpen]);
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
  // table (key 'today-visited'), read via the shared ['settings']
  // query (same key + shape as Stats/Goals). localStorage is kept as
  // a synchronous cache so first paint doesn't flash a stale dot; the
  // server value overrides it once loaded. Same-device visits update
  // the cache directly (Today.jsx setQueryData), so no per-navigation
  // fetch is needed; cross-device drift is caught by the global
  // data-version check in lib/queryClient.js — visiting Today on the
  // phone bumps the server version, and the PC's next tab-focus check
  // invalidates ['settings'] along with everything else.
  const onTodayCurrent = pathname === '/today' && !search;
  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  });
  const [localVisited] = useState(() => {
    try { return localStorage.getItem(TODAY_VISITED_KEY); } catch { return null; }
  });
  const serverVisited = settingsQ.data?.[TODAY_VISITED_KEY] ?? null;
  const visitedTodayStr = serverVisited ?? localVisited;

  useEffect(() => {
    if (!serverVisited) return;
    try { localStorage.setItem(TODAY_VISITED_KEY, serverVisited); } catch {}
  }, [serverVisited]);

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
        <div className="flex items-center gap-3 sm:gap-6">
          {/* Hamburger toggle — mobile only. Sits before the brand so it
              lands in the thumb-friendly top-left corner and doesn't
              compete with the Add-book affordance on the right. The
              showTodayDot indicator rides on the icon when the drawer
              is closed so users see the "new today" cue without
              opening the menu. */}
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="sm:hidden relative -ml-1 p-2 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <MenuIcon open={menuOpen} />
            {!menuOpen && showTodayDot && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-teal-400"
              />
            )}
          </button>
          <Link
            to="/"
            className="font-slab text-xl tracking-wider text-parchment hover:text-leather transition-colors uppercase flex items-baseline gap-1.5"
          >
            Spine
            <span className="hidden sm:inline text-[10px] tracking-normal text-neutral-700 font-normal normal-case">v{__APP_VERSION__}</span>
          </Link>
          {/* Inline nav — desktop only. Mobile users get the same items
              behind the hamburger drawer below. */}
          <nav className="hidden sm:flex items-center gap-5">
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
        <div className="flex items-center gap-1">
          {/* Mobile-only search button — opens the global command
              palette. Desktop has Ctrl/Cmd+K for the same; phones
              can't fire that, so they need a tap target. The
              palette covers search, navigation, and quick actions
              all at once. */}
          <button
            type="button"
            onClick={() => {
              // If the drawer was open, close it before opening the
              // palette — otherwise it stays behind the modal, focus
              // return on palette-close lands on a stale state, and
              // both compete for body-scroll lock on iOS.
              setMenuOpen(false);
              dispatchSpineEvent('spine:open-command-palette');
            }}
            aria-label="Search"
            className="sm:hidden -mr-1 p-2 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <SearchIcon />
          </button>
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
      </div>

      {/* Mobile drawer. Conditionally rendered — when closed, nothing
          is in the DOM at all. The previous always-rendered + opacity/
          translate toggle approach had multiple classes of fragility
          (1.244.2 collapsed via a bad dvh inline height; 1.244.3 still
          left the slide animation depending on `transform translate-x-*`
          + transition-visibility resolving correctly in the field,
          which the user reported still failed). Conditional rendering
          eliminates that whole surface area: if menuOpen is true, the
          drawer is in the DOM with a fixed positioned overlay; if not,
          it isn't. We lose the slide animation in exchange for known-
          working show/hide. */}
      {menuOpen && (
        <div className="sm:hidden fixed inset-0 top-14 z-40">
          {/* Backdrop — tap to close. */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
          />
          <nav
            id="mobile-nav-drawer"
            aria-label="Main navigation"
            className="absolute top-0 left-0 bottom-0 w-64 max-w-[80vw] bg-neutral-900 border-r border-neutral-800/60 overflow-y-auto shadow-2xl"
          >
            {/* Each link gets its own row with a generous tap target.
                The accent stripe on the left mirrors each link's
                identity colour from the desktop nav. */}
            <ul className="py-2">
              {[
                { to: '/today',      label: 'Today',    active: onToday,     color: 'text-teal-400',    bar: 'bg-teal-400',    dot: showTodayDot },
                { to: '/readlist',   label: 'Readlist', active: onReadlist,  color: 'text-sky-400',     bar: 'bg-sky-400'     },
                { to: '/lists',      label: 'Lists',    active: onLists,     color: 'text-emerald-400', bar: 'bg-emerald-400' },
                { to: '/loved',      label: 'Loved',    active: onLoved,     color: 'text-rose-400',    bar: 'bg-rose-400'    },
                { to: '/diary',      label: 'Diary',    active: onDiary,     color: 'text-amber-400',   bar: 'bg-amber-400'   },
                { to: '/notes',      label: 'Notes',    active: onNotes,     color: 'text-leather',     bar: 'bg-leather'     },
                { to: '/stats',      label: 'Stats',    active: onStats,     color: 'text-violet-400',  bar: 'bg-violet-400'  },
                { to: '/shelf-view', label: 'Shelves',  active: onShelfView, color: 'text-oak',         bar: 'bg-oak'         },
              ].map(item => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={item.active ? 'page' : undefined}
                    className={`relative flex items-center px-5 py-3.5 text-base transition-colors ${
                      item.active ? item.color : 'text-neutral-300 hover:text-neutral-100'
                    }`}
                  >
                    {item.active && (
                      <span
                        aria-hidden="true"
                        className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r ${item.bar}`}
                      />
                    )}
                    {item.label}
                    {item.dot && (
                      <span
                        aria-label="New today"
                        className="ml-2 w-1.5 h-1.5 rounded-full bg-teal-400"
                      />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}
