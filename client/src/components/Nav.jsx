import { Link, useLocation } from 'react-router-dom';
import { labelForPath } from '../utils.js';

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
  const onNotes = pathname === '/notes';
  const onStats = pathname === '/stats';
  const onShelfView   = pathname === '/shelf-view';

  // Inactive hover shifts toward the link's own active hue (one shade
  // brighter than active) instead of the previous uniform neutral-200,
  // so each surface previews its identity colour on hover.
  function navLink(to, label, active, activeColor = 'text-sky-400', hoverColor = 'hover:text-sky-300') {
    return (
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={`text-sm transition-colors ${active ? activeColor : `text-neutral-500 ${hoverColor}`}`}
      >
        {label}
      </Link>
    );
  }

  return (
    // Header is transparent at the gutter edges so the atmosphere art
    // extends to the top of the viewport — the opaque bg + border + blur
    // sit only on the centred max-w-7xl band where the Nav contents live
    // and where page content scrolls under the sticky header.
    <header className="sticky top-0 z-50">
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
