import { Link } from 'react-router-dom';

const STATUS_BAR = {
  reading: 'bg-emerald-500',
  finished: 'bg-sky-500',
  unread: 'bg-neutral-600',
};

export default function BookCard({ book }) {
  return (
    <Link to={`/books/${book.id}`} className="group block">
      <div className="relative aspect-[2/3] bg-neutral-800 rounded overflow-hidden mb-2.5 shadow-xl ring-1 ring-white/5">
        {book.cover_path ? (
          <img
            src={book.cover_path}
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-end p-3 bg-gradient-to-br from-neutral-700 to-neutral-900">
            <span className="text-xs text-neutral-400 font-medium leading-tight line-clamp-4">{book.title}</span>
          </div>
        )}
        {book.rating && (
          <div className="absolute top-1.5 right-1.5 bg-black/75 text-amber-400 text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">
            {'★'.repeat(book.rating)}
          </div>
        )}
        <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${STATUS_BAR[book.status]}`} />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>
      <p className="text-sm font-medium text-neutral-200 truncate group-hover:text-white transition-colors leading-tight">
        {book.title}
      </p>
      {book.author && (
        <p className="text-xs text-neutral-500 truncate mt-0.5">{book.author}</p>
      )}
    </Link>
  );
}
