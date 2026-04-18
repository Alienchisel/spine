import { Link } from 'react-router-dom';

export default function Nav() {
  return (
    <header className="border-b border-neutral-800/60 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <Link
          to="/"
          className="font-slab text-xl tracking-wider text-parchment hover:text-leather transition-colors uppercase"
        >
          Spine
        </Link>
        <Link
          to="/books/new"
          className="text-sm font-medium bg-oak hover:bg-leather text-neutral-950 px-4 py-1.5 rounded-full transition-colors"
        >
          + Add book
        </Link>
      </div>
    </header>
  );
}
