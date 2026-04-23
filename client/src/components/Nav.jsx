import { Link, useLocation } from 'react-router-dom';

export default function Nav() {
  const { pathname } = useLocation();
  const showAddButton = pathname === '/' || pathname.startsWith('/browse');
  const onReadlist = pathname === '/readlist';
  const onLoved = pathname === '/loved';
  const onLists = pathname === '/lists' || pathname.startsWith('/lists/');
  const onDiary = pathname === '/diary';
  const onStats = pathname === '/stats';
  const onShelf = pathname === '/shelf';

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
    <header className="border-b border-neutral-800/60 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="font-slab text-xl tracking-wider text-parchment hover:text-leather transition-colors uppercase"
          >
            Spine
          </Link>
          <nav className="flex items-center gap-5">
            {navLink('/readlist', 'Readlist', onReadlist, 'text-sky-400')}
            {navLink('/loved',    'Loved',    onLoved,    'text-rose-400')}
            {navLink('/lists',    'Lists',    onLists,    'text-sky-400')}
            {navLink('/diary',    'Diary',    onDiary,    'text-amber-400')}
            {navLink('/stats',   'Stats',    onStats,    'text-neutral-300')}
            {navLink('/shelf',   'Shelves',  onShelf,    'text-neutral-300')}
          </nav>
        </div>
        {showAddButton && (
          <Link
            to="/books/new"
            className="text-sm font-medium bg-oak hover:bg-leather active:scale-[0.98] text-neutral-950 px-4 py-1.5 rounded-full transition-[transform,background-color] ease-out duration-150"
          >
            + Add book
          </Link>
        )}
      </div>
    </header>
  );
}
