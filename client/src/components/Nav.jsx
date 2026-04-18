import { Link, useLocation } from 'react-router-dom';

export default function Nav() {
  const { pathname } = useLocation();
  const showAddButton = pathname === '/' || pathname.startsWith('/browse');
  return (
    <header className="border-b border-neutral-800/60 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link
          to="/"
          className="font-slab text-xl tracking-wider text-parchment hover:text-leather transition-colors uppercase"
        >
          Spine
        </Link>
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
