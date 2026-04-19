import { Link, useLocation } from 'react-router-dom';

function EyeIcon({ active }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
      <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
      <path fillRule="evenodd" d="M1.38 8a6.998 6.998 0 0 1 13.24 0 7 7 0 0 1-13.24 0ZM8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" clipRule="evenodd" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
      <path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314Z" />
    </svg>
  );
}

export default function Nav() {
  const { pathname } = useLocation();
  const showAddButton = pathname === '/' || pathname.startsWith('/browse');
  const onReadlist = pathname === '/readlist';
  const onLoved = pathname === '/loved';
  return (
    <header className="border-b border-neutral-800/60 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <Link
            to="/"
            className="font-slab text-xl tracking-wider text-parchment hover:text-leather transition-colors uppercase"
          >
            Spine
          </Link>
          <Link
            to="/readlist"
            className={`transition-colors ${onReadlist ? 'text-sky-400' : 'text-neutral-600 hover:text-neutral-300'}`}
            title="Readlist"
          >
            <EyeIcon />
          </Link>
          <Link
            to="/loved"
            className={`transition-colors ${onLoved ? 'text-rose-400' : 'text-neutral-600 hover:text-neutral-300'}`}
            title="Loved"
          >
            <HeartIcon />
          </Link>
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
