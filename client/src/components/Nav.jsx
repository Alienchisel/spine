import { Link, useLocation } from 'react-router-dom';

function BookmarkIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
      <path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v12.5a.75.75 0 0 1-1.18.617L8 12.21l-4.82 3.657A.75.75 0 0 1 2 15.25V2.75Z" />
    </svg>
  );
}

function DiaryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3 2.75A2.75 2.75 0 0 1 5.75 0h7.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H5a2 2 0 0 1-2-2V2.75Zm3.25.5a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Zm0 3a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Zm0 3a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5Zm-2.5 4a.5.5 0 0 0 .5.5h7.25V13H4.5a.5.5 0 0 0-.5.5Z" clipRule="evenodd" />
    </svg>
  );
}

function ListsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75Zm0 4A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75Zm0 4a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
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
  const onLists = pathname === '/lists' || pathname.startsWith('/lists/');
  const onDiary = pathname === '/diary';
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
            <BookmarkIcon />
          </Link>
          <Link
            to="/loved"
            className={`transition-colors ${onLoved ? 'text-rose-400' : 'text-neutral-600 hover:text-neutral-300'}`}
            title="Loved"
          >
            <HeartIcon />
          </Link>
          <Link
            to="/lists"
            className={`transition-colors ${onLists ? 'text-sky-400' : 'text-neutral-600 hover:text-neutral-300'}`}
            title="Lists"
          >
            <ListsIcon />
          </Link>
          <Link
            to="/diary"
            className={`transition-colors ${onDiary ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-300'}`}
            title="Diary"
          >
            <DiaryIcon />
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
