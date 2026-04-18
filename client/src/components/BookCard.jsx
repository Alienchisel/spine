import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const STATUS_BAR = {
  reading: 'bg-emerald-500',
  finished: 'bg-sky-500',
  unread: 'bg-neutral-600',
};

function getModeKey(bookId) {
  return `spine-progress-mode-${bookId}`;
}

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.263-4.263a1.75 1.75 0 0 0 0-2.474ZM3.25 12.25a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5Z" />
    </svg>
  );
}

export default function BookCard({ book: initialBook, onProgressUpdate }) {
  const [book, setBook] = useState(initialBook);
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [mode, setMode] = useState(() => localStorage.getItem(getModeKey(initialBook.id)) || 'page');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => { setBook(initialBook); }, [initialBook]);

  const pct = book.page_count && book.current_page
    ? Math.min(100, Math.round((book.current_page / book.page_count) * 100))
    : null;
  const hasPct = Boolean(book.page_count);

  function openEditor(e) {
    e.preventDefault();
    if (mode === 'pct') {
      setInputVal(pct !== null ? String(pct) : '');
    } else {
      setInputVal(book.current_page !== null && book.current_page !== undefined ? String(book.current_page) : '');
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function changeMode(m) {
    setMode(m);
    localStorage.setItem(getModeKey(book.id), m);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (inputVal === '') return;
    setSaving(true);
    try {
      let current_page;
      if (mode === 'pct') {
        current_page = Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.page_count);
      } else {
        current_page = Math.max(0, parseInt(inputVal));
      }
      const updated = await api.patchBook(book.id, { current_page });
      setBook(updated);
      onProgressUpdate?.(updated);
      setOpen(false);
      setInputVal('');
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
  }

  const progressLabel = book.current_page
    ? hasPct ? `${pct}%` : `p. ${book.current_page}`
    : null;

  return (
    <div onKeyDown={handleKeyDown}>
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
          {book.status === 'reading' && pct !== null ? (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-700">
              <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          ) : (
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
          <button
            onClick={openEditor}
            className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
          >
            <span>{progressLabel ?? 'Set progress…'}</span>
            <span className="text-neutral-700 hover:text-neutral-400 transition-colors"><PencilIcon /></span>
          </button>

          {open && (
            <form ref={formRef} onSubmit={handleSubmit} className="mt-1.5 flex gap-1 items-center">
              <select
                value={mode}
                onChange={(e) => changeMode(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs rounded px-1.5 py-1 focus:outline-none"
              >
                <option value="page">Page</option>
                {hasPct && <option value="pct">%</option>}
              </select>
              <input
                ref={inputRef}
                type="number"
                min="0"
                max={mode === 'pct' ? 100 : (book.page_count || undefined)}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder={mode === 'pct' ? '0–100' : 'page #'}
                className="flex-1 min-w-0 bg-neutral-800 border border-neutral-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-neutral-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="submit"
                disabled={saving || inputVal === ''}
                className="text-xs bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 text-white px-2 py-1 rounded transition-colors"
              >
                {saving ? '…' : '✓'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-neutral-600 hover:text-neutral-400 px-1 py-1"
              >
                ✕
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
