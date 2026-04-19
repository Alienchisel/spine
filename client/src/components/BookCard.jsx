import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import ListPicker from './ListPicker.jsx';

const STATUS_BAR = {
  reading:  'bg-oak',
  paused:   'bg-neutral-500',
  finished: 'bg-leather',
  unread:   'bg-neutral-600',
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
  const [loving, setLoving] = useState(false);
  const [listing, setListing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [inputH, setInputH] = useState('');
  const [inputM, setInputM] = useState('');
  const [mode, setMode] = useState(() => localStorage.getItem(getModeKey(initialBook.id)) || (initialBook.format === 'audiobook' ? 'min' : 'page'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => { setBook(initialBook); }, [initialBook]);

  const isAudiobook = book.format === 'audiobook';
  const pct = isAudiobook
    ? (book.duration_minutes && book.current_minutes != null
        ? Math.min(100, Math.round((book.current_minutes / book.duration_minutes) * 100))
        : null)
    : (book.page_count && book.current_page != null
        ? Math.min(100, Math.round((book.current_page / book.page_count) * 100))
        : null);
  const hasPct = isAudiobook ? Boolean(book.duration_minutes) : Boolean(book.page_count);

  function openEditor(e) {
    e.preventDefault();
    if (mode === 'pct') {
      setInputVal(pct !== null ? String(pct) : '');
    } else if (isAudiobook) {
      const mins = book.current_minutes;
      setInputH(mins != null ? String(Math.floor(mins / 60)) : '');
      setInputM(mins != null ? String(mins % 60) : '');
    } else {
      setInputVal(book.current_page != null ? String(book.current_page) : '');
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function changeMode(m) {
    setMode(m);
    localStorage.setItem(getModeKey(book.id), m);
    if (m === 'pct') {
      setInputVal(pct !== null ? String(pct) : '');
    } else if (isAudiobook) {
      const mins = book.current_minutes;
      setInputH(mins != null ? String(Math.floor(mins / 60)) : '');
      setInputM(mins != null ? String(mins % 60) : '');
    } else {
      setInputVal(book.current_page != null ? String(book.current_page) : '');
    }
  }

  const isHMMode = isAudiobook && mode === 'min';
  const isEmpty = isHMMode ? (inputH === '' && inputM === '') : inputVal === '';

  function clampMinutes(val) {
    const n = parseInt(val);
    if (isNaN(n)) return '';
    return String(Math.min(59, Math.max(0, n)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (isEmpty) return;
    setError(null);
    setSaving(true);
    try {
      let patchData;
      if (isAudiobook) {
        const current_minutes = mode === 'pct'
          ? Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.duration_minutes)
          : (parseInt(inputH) || 0) * 60 + (parseInt(inputM) || 0);
        if (isNaN(current_minutes)) { setError('Invalid value'); return; }
        patchData = { current_minutes };
      } else {
        const current_page = mode === 'pct'
          ? Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.page_count)
          : Math.max(0, parseInt(inputVal));
        if (isNaN(current_page)) { setError('Invalid value'); return; }
        patchData = { current_page };
      }
      const updated = await api.patchBook(book.id, patchData);
      setBook(updated);
      onProgressUpdate?.(updated);
      setOpen(false);
      setInputVal('');
      setInputH('');
      setInputM('');
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleLoved(e) {
    e.preventDefault();
    if (loving) return;
    setLoving(true);
    try {
      const updated = await api.patchBook(book.id, { loved: book.loved ? 0 : 1 });
      setBook(updated);
      onProgressUpdate?.(updated);
    } finally {
      setLoving(false);
    }
  }

  async function toggleReadlist(e) {
    e.preventDefault();
    if (listing) return;
    setListing(true);
    try {
      const updated = await api.patchBook(book.id, { on_readlist: book.on_readlist ? 0 : 1 });
      setBook(updated);
      onProgressUpdate?.(updated);
    } finally {
      setListing(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
  }

  const progressLabel = isAudiobook
    ? (book.current_minutes != null ? `${pct}%` : null)
    : (book.current_page ? (hasPct ? `${pct}%` : `p. ${book.current_page}`) : null);

  const numCls = 'bg-neutral-800 border border-neutral-700 text-parchment text-xs rounded px-2 py-1 focus:outline-none focus:border-leather [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <div onKeyDown={handleKeyDown} className="bg-card rounded-lg p-2 pb-2.5 hover:-translate-y-0.5 transition-[transform,background-color] ease-out duration-150">
      <Link to={`/books/${book.id}`} className="group block">
        <div className="relative aspect-[2/3] bg-neutral-800 rounded overflow-hidden mb-2.5 shadow-xl ring-1 ring-white/5">
          {book.cover_path ? (
            <img
              src={book.cover_path}
              alt={book.title}
              className={`${book.format === 'audiobook' ? 'absolute bottom-0 left-0 right-0 w-full' : 'w-full h-full object-cover'} group-hover:scale-105 transition-transform duration-300`}
            />
          ) : (
            <div className="w-full h-full flex items-end p-3 bg-gradient-to-br from-neutral-700 to-neutral-900">
              <span className="text-xs text-neutral-400 font-medium leading-tight line-clamp-4">{book.title}</span>
            </div>
          )}
          {Boolean(book.is_custom) && (
            <div className="absolute top-1.5 left-1.5 bg-black/75 text-leather text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm leading-none">
              ✦
            </div>
          )}
          {book.rating && (
            <div className="absolute top-1.5 right-1.5 bg-black/75 text-oak text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">
              {'★'.repeat(book.rating)}
            </div>
          )}
          {(book.status === 'reading' || book.status === 'paused') && pct !== null ? (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-700">
              <div className={`h-full transition-all duration-300 ${book.status === 'paused' ? 'bg-neutral-500' : 'bg-oak'}`} style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${STATUS_BAR[book.status]}`} />
          )}
          <div className="absolute bottom-1.5 right-1.5 flex gap-0.5 items-center">
            <button
              onClick={toggleReadlist}
              disabled={listing}
              className={`bg-black/60 backdrop-blur-sm rounded px-1 py-0.5 leading-none transition-colors disabled:opacity-50 ${book.on_readlist ? 'text-sky-400' : 'text-neutral-600 hover:text-neutral-300'}`}
              title={book.on_readlist ? 'On readlist' : 'Add to readlist'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v12.5a.75.75 0 0 1-1.18.617L8 12.21l-4.82 3.657A.75.75 0 0 1 2 15.25V2.75Z" />
              </svg>
            </button>
            <button
              onClick={toggleLoved}
              disabled={loving}
              className={`bg-black/60 backdrop-blur-sm rounded px-1 py-0.5 text-sm leading-none transition-colors disabled:opacity-50 ${book.loved ? 'text-red-400' : 'text-neutral-600 hover:text-neutral-300'}`}
              title={book.loved ? 'Loved' : 'Mark as loved'}
            >
              {book.loved ? '♥' : '♡'}
            </button>
            <ListPicker bookId={book.id} dropUp iconClassName="w-3 h-3" buttonClassName="bg-black/60 backdrop-blur-sm rounded px-1 py-0.5" />
          </div>
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
        </div>
        <p className="text-sm font-medium text-neutral-200 truncate group-hover:text-white transition-colors leading-tight">
          {book.title}
        </p>
        {book.author && (
          <p className="text-xs text-neutral-500 truncate mt-0.5">{book.author}</p>
        )}
      </Link>

      {(book.status === 'reading' || book.status === 'paused') && (
        <div className="mt-1.5">
          <button
            onClick={openEditor}
            className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
          >
            <span>{progressLabel ?? 'Set progress…'}</span>
            <span className="text-neutral-700 hover:text-neutral-400 transition-colors"><PencilIcon /></span>
          </button>

          {open && (
            <form ref={formRef} onSubmit={handleSubmit} className="mt-1.5 flex gap-1 items-center flex-wrap">
              <select
                value={mode}
                onChange={(e) => changeMode(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 text-neutral-300 text-xs rounded px-1.5 py-1 focus:outline-none"
              >
                {isAudiobook ? <option value="min">h/m</option> : <option value="page">pg</option>}
                {hasPct && <option value="pct">%</option>}
              </select>
              {isHMMode ? (
                <>
                  <input
                    ref={inputRef}
                    type="number" min="0" max="999"
                    value={inputH}
                    onChange={(e) => { setError(null); setInputH(e.target.value); }}
                    placeholder="h"
                    className={`w-10 ${numCls}`}
                  />
                  <span className="text-neutral-500 text-xs">h</span>
                  <input
                    type="number" min="0" max="59"
                    value={inputM}
                    onChange={(e) => { setError(null); setInputM(e.target.value); }}
                    onBlur={(e) => setInputM(clampMinutes(e.target.value))}
                    placeholder="m"
                    className={`w-10 ${numCls}`}
                  />
                  <span className="text-neutral-500 text-xs">m</span>
                </>
              ) : (
                <input
                  ref={inputRef}
                  type="number"
                  min="0"
                  max={mode === 'pct' ? 100 : (book.page_count || undefined)}
                  value={inputVal}
                  onChange={(e) => { setError(null); setInputVal(e.target.value); }}
                  placeholder={mode === 'pct' ? '0–100' : '#'}
                  className={`flex-1 min-w-[3rem] ${numCls}`}
                />
              )}
              <button
                type="submit"
                disabled={saving || isEmpty}
                className="text-xs bg-binding hover:bg-binding/80 active:scale-[0.98] disabled:opacity-40 text-parchment px-2 py-1 rounded transition-[transform,background-color] ease-out duration-150"
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
              {error && <p className="w-full text-xs text-warn mt-0.5">{error}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
