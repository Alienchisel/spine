import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STATUS_BAR = {
  reading: 'bg-emerald-500',
  finished: 'bg-sky-500',
  unread: 'bg-neutral-600',
};

export default function BookCard({ book, onProgressUpdate }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef(null);

  const pct = book.page_count && book.current_page
    ? Math.min(100, Math.round((book.current_page / book.page_count) * 100))
    : null;

  function startEditing(e) {
    e.preventDefault();
    setInputVal(book.current_page ?? '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function commit() {
    setEditing(false);
    const val = inputVal === '' ? null : parseInt(inputVal);
    if (val === book.current_page) return;
    const updated = await api.patchBook(book.id, { current_page: val });
    onProgressUpdate?.(updated);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') inputRef.current?.blur();
    if (e.key === 'Escape') { setEditing(false); }
  }

  return (
    <div>
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
          {pct !== null && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-700">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          {pct === null && (
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${STATUS_BAR[book.status]}`} />
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
        </div>
        <p className="text-sm font-medium text-neutral-200 truncate group-hover:text-white transition-colors leading-tight">
          {book.title}
        </p>
        {book.author && (
          <p className="text-xs text-neutral-500 truncate mt-0.5">{book.author}</p>
        )}
      </Link>

      {book.status === 'reading' && (
        <div className="mt-1.5">
          {editing ? (
            <input
              ref={inputRef}
              type="number"
              min="0"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
              className="w-full bg-neutral-800 text-white text-xs px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
              placeholder="Current page"
            />
          ) : (
            <button
              onClick={startEditing}
              className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors w-full text-left"
            >
              {book.current_page
                ? pct !== null ? `p. ${book.current_page} / ${book.page_count} (${pct}%)` : `p. ${book.current_page}`
                : 'Set page…'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
