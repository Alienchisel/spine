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
  // hasn't landed on /today yet this calendar day. While the user IS on
  // /today the dot is suppressed via the pathname check, so there's no
  // visual race with Today.jsx's localStorage write — the dot is gone
  // the moment they're on the page, even before the write commits.
  // Pathname-driven re-render handles routes changing; the localStorage
  // read happens fresh on each Nav render which is bound to useLocation,
  // so navigating away from /today re-evaluates with the just-written
  // visited date.
  let visitedTodayStr = null;
  try { visitedTodayStr = localStorage.getItem(TODAY_VISITED_KEY); } catch {}
  const showTodayDot = !onToday && visitedTodayStr !== todayStr();

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
            {/* Each nav item has its own identity colour. Cool tones
                (sky/emerald/violet) for the curation + analytical
                surfaces, warm tones (rose/amber/oak) for the more
                emotional / theme-aligned ones. */}
            {navLink('/readlist',   'Readlist', onReadlist,  'text-sky-400',     'hover:text-sky-300')}
            {navLink('/lists',      'Lists',    onLists,     'text-emerald-400', 'hover:text-emerald-300')}
            {navLink('/loved',      'Loved',    onLoved,     'text-rose-400',    'hover:text-rose-300')}
            {navLink('/diary',      'Diary',    onDiary,     'text-amber-400',   'hover:text-amber-300')}
            {navLink('/today',      'Today',    onToday,     'text-teal-400',    'hover:text-teal-300', showTodayDot)}
            {navLink('/notes',      'Notes',    onNotes,     'text-leather',     'hover:text-parchment')}
            {navLink('/stats',      'Stats',    onStats,     'text-violet-400',  'hover:text-violet-300')}
            {navLink('/shelf-view', 'Shelves',  onShelfView, 'text-oak',         'hover:text-leather')}
          </nav>
        </div>
        <Link
          to="/books/new"
          state={{ from: labelForPath(pathname), fromPath: pathname + search }}
          className="text-sm font-medium bg-oak hover:bg-leather motion-safe:active:scale-[0.98] text-neutral-950 px-4 py-1.5 rounded-full transition-[transform,background-color] ease-out duration-150"
        >
          + Add book
        </Link>
      </div>
    </header>
  );
}
