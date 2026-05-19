import { Link, useLocation } from 'react-router-dom';
import { labelForPath } from '../utils.js';

export default function Nav() {
  const { pathname, search } = useLocation();
  const showAddButton = pathname === '/' || pathname.startsWith('/browse');
  const onReadlist = pathname === '/readlist';
  const onLoved = pathname === '/loved';
  const onLists = pathname === '/lists' || pathname.startsWith('/lists/');
  const onDiary = pathname === '/diary';
  const onStats = pathname === '/stats';
  const onShelfView   = pathname === '/shelf-view';

  function navLink(to, label, active, activeColor = 'text-sky-400') {
    return (
      <Link
        to={to}
        className={`text-sm transition-colors ${active ? activeColor : 'text-neutral-500 hover:text-neutral-200'}`}
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
            {navLink('/readlist', 'Readlist', onReadlist, 'text-sky-400')}
            {navLink('/loved',    'Loved',    onLoved,    'text-rose-400')}
            {navLink('/lists',    'Lists',    onLists,    'text-sky-400')}
            {navLink('/diary',    'Diary',    onDiary,    'text-amber-400')}
            {navLink('/stats',   'Stats',    onStats,    'text-neutral-300')}
            {navLink('/shelf-view', 'Shelves', onShelfView, 'text-neutral-300')}
          </nav>
        </div>
        {showAddButton && (
          <Link
            to="/books/new"
            state={{ from: labelForPath(pathname), fromPath: pathname + search }}
            className="text-sm font-medium bg-oak hover:bg-leather motion-safe:active:scale-[0.98] text-neutral-950 px-4 py-1.5 rounded-full transition-[transform,background-color] ease-out duration-150"
          >
            + Add book
          </Link>
        )}
      </div>
    </header>
  );
}
