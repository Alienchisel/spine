import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { realTagNames, formatAuthors } from '../utils.js';
import ListPicker from './ListPicker.jsx';
import StarRating from './StarRating.jsx';

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

export default function BookCard({ book: initialBook, onProgressUpdate, compact, coverOverlay }) {
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
  const [ratingPrompt, setRatingPrompt] = useState(false);
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

  // For 'remaining' mode the h/m inputs represent time-remaining; we
  // convert to/from current_minutes at the input/submit boundary.
  function audioMinutesForMode(m, b) {
    if (b.current_minutes == null) return null;
    if (m === 'remaining') {
      if (!b.duration_minutes) return null;
      return Math.max(0, b.duration_minutes - b.current_minutes);
    }
    return b.current_minutes;
  }

  function openEditor(e) {
    e.preventDefault();
    setError(null);
    if (mode === 'pct') {
      setInputVal(pct !== null ? String(pct) : '');
    } else if (isAudiobook) {
      const mins = audioMinutesForMode(mode, book);
      setInputH(mins != null ? String(Math.floor(mins / 60)) : '');
      setInputM(mins != null ? String(mins % 60) : '');
    } else {
      setInputVal(book.current_page != null ? String(book.current_page) : '');
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function changeMode(m) {
    setError(null);
    setMode(m);
    localStorage.setItem(getModeKey(book.id), m);
    if (m === 'pct') {
      setInputVal(pct !== null ? String(pct) : '');
    } else if (isAudiobook) {
      const mins = audioMinutesForMode(m, book);
      setInputH(mins != null ? String(Math.floor(mins / 60)) : '');
      setInputM(mins != null ? String(mins % 60) : '');
    } else {
      setInputVal(book.current_page != null ? String(book.current_page) : '');
    }
  }

  const isHMMode = isAudiobook && (mode === 'min' || mode === 'remaining');
  const isEmpty = isHMMode ? (inputH === '' && inputM === '') : inputVal === '';

  function clampMinutes(val) {
    const n = parseInt(val);
    if (isNaN(n)) return '';
    return String(Math.min(59, Math.max(0, n)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Mirror the disabled button. Double-fire near the page_count boundary
    // could double-trigger the auto-finish reads-row insert.
    if (saving || isEmpty) return;

    // Build and validate the patch BEFORE arming the spinner. Validation
    // returns inside try { } would still hit finally and reset `saving`
    // (JS semantics), but mixing "compute" with "in-flight" inside the
    // same try-block reads like a stuck-spinner footgun. Split the phases.
    let patchData;
    if (isAudiobook) {
      const enteredMinutes = (parseInt(inputH) || 0) * 60 + (parseInt(inputM) || 0);
      let current_minutes;
      if (mode === 'pct') {
        current_minutes = Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.duration_minutes);
      } else if (mode === 'remaining') {
        if (!book.duration_minutes) { setError('Duration unknown'); return; }
        current_minutes = Math.max(0, Math.min(book.duration_minutes, book.duration_minutes - enteredMinutes));
      } else {
        current_minutes = enteredMinutes;
      }
      if (isNaN(current_minutes)) { setError('Invalid value'); return; }
      patchData = { current_minutes };
    } else {
      const current_page = mode === 'pct'
        ? Math.round((Math.min(100, Math.max(0, parseFloat(inputVal))) / 100) * book.page_count)
        : Math.max(0, parseInt(inputVal));
      if (isNaN(current_page)) { setError('Invalid value'); return; }
      patchData = { current_page };
    }

    setError(null);
    setSaving(true);
    try {
      const updated = await api.patchBook(book.id, patchData);
      const isComplete = isAudiobook
        ? (updated.duration_minutes > 0 && updated.current_minutes >= updated.duration_minutes)
        : (updated.page_count > 0 && updated.current_page >= updated.page_count);
      if (isComplete && (updated.status === 'reading' || updated.status === 'paused')) {
        const finished = await api.updateBook(book.id, {
          ...updated,
          status: 'finished',
          tags: realTagNames(updated.tags),
        });
        setBook(finished);
        onProgressUpdate?.(finished);
        setRatingPrompt(true);
      } else {
        setBook(updated);
        onProgressUpdate?.(updated);
      }
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
    setError(null);
    try {
      const updated = await api.patchBook(book.id, { loved: book.loved ? 0 : 1 });
      setBook(updated);
      onProgressUpdate?.(updated);
    } catch {
      setError('Failed to update loved');
    } finally {
      setLoving(false);
    }
  }

  async function toggleReadlist(e) {
    e.preventDefault();
    if (listing) return;
    setListing(true);
    setError(null);
    try {
      const updated = await api.patchBook(book.id, { on_readlist: book.on_readlist ? 0 : 1 });
      setBook(updated);
      onProgressUpdate?.(updated);
    } catch {
      setError('Failed to update readlist');
    } finally {
      setListing(false);
    }
  }

  async function handleRate(rating) {
    setError(null);
    try {
      // Only forward `tags` if the parent actually loaded them onto the book
      // prop. Sending `tags: []` when we don't know the real tags would wipe
      // them; omitting the key tells the backend to leave them untouched.
      const payload = { ...book, rating };
      if (book.tags !== undefined) payload.tags = realTagNames(book.tags);
      const rated = await api.updateBook(book.id, payload);
      setBook(rated);
      onProgressUpdate?.(rated);
      setRatingPrompt(false);
    } catch {
      setError('Failed to save rating');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
  }

  const progressLabel = isAudiobook
    ? (book.current_minutes != null ? `${pct}%` : null)
    : (book.current_page != null ? (hasPct ? `${pct}%` : `p. ${book.current_page}`) : null);

  const numCls = 'bg-neutral-800 border border-neutral-700 text-parchment text-xs rounded px-2 py-1 focus:outline-none focus:border-leather [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  // Archived books are dimmed and slightly desaturated so the state reads at
  // a glance — used on the Archived tab and on search-result cards (search
  // surfaces archived items so users can find them to un-archive).
  const archivedDim = book.archived ? 'opacity-60 saturate-50' : '';

  return (
    <div onKeyDown={handleKeyDown} className={`transition-[background-color] ease-out duration-150 ${archivedDim}`}>
      <Link
        to={`/books/${book.id}`}
        className="group block"
        title={[
          book.title,
          book.authors?.map(a => a.name).join(', '),
          isAudiobook && book.narrators?.length > 0 ? `read by ${book.narrators.map(n => n.name).join(', ')}` : null,
        ].filter(Boolean).join(' — ')}
      >
        {/* Hover signal: a 2px white inset frame on the cover. Implemented
            via an absolute-positioned overlay sibling AFTER the img so the
            box-shadow paints above the image content — `box-shadow: inset`
            on the frame itself would render below the img (per the CSS
            painting order: bg → inset shadow → content) and be invisible
            on covers whose artwork fills the frame. */}
        <div className={`relative bg-neutral-800 overflow-hidden ${compact ? 'aspect-[2/3] rounded-sm' : 'aspect-[2/3] rounded mb-2.5 shadow-xl'}`}>
          {book.cover_path ? (
            <img
              src={book.cover_path}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-neutral-700 to-neutral-900 gap-2">
              <span className="text-5xl font-bold text-neutral-500 select-none leading-none">
                {(book.title.replace(/^(the|a|an)\s+/i, '') || book.title)[0].toUpperCase()}
              </span>
              <span className="text-xs text-neutral-500 font-medium leading-tight line-clamp-3 text-center">{book.title}</span>
            </div>
          )}
          {Boolean(book.is_custom) && (
            <div className="absolute top-1.5 left-1.5 bg-black/75 text-leather text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm leading-none">
              ✦
            </div>
          )}
          {book.rating && (
            <div className="absolute top-1.5 right-1.5 bg-black/75 text-oak text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">
              {'★'.repeat(Math.floor(book.rating))}{book.rating % 1 !== 0 ? '½' : ''}
            </div>
          )}
          {(book.status === 'reading' || book.status === 'paused') && pct !== null ? (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-700">
              <div className={`h-full transition-all duration-300 ${book.status === 'paused' ? 'bg-neutral-500' : 'bg-oak'}`} style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${STATUS_BAR[book.status]}`} />
          )}
          {!compact && (
            // Self-contained dark tray that holds the action icons. The
            // whole tray (rectangle + contents) fades in together on hover
            // — at rest the cover is fully uncluttered. Active state
            // (loved, on_readlist) still expresses via colour once the tray
            // is visible. Sits above the title-overlay band that fades in
            // along the bottom of the cover.
            <div className="absolute inset-x-3 bottom-14 flex justify-center items-center gap-4 px-3 py-1.5 bg-black/65 backdrop-blur-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={toggleReadlist}
                disabled={listing}
                className={`leading-none transition-colors disabled:opacity-50 ${book.on_readlist ? 'text-sky-400 hover:text-sky-300' : 'text-white hover:text-sky-300'}`}
                title={book.on_readlist ? 'On readlist' : 'Add to readlist'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
                  <path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v12.5a.75.75 0 0 1-1.18.617L8 12.21l-4.82 3.657A.75.75 0 0 1 2 15.25V2.75Z" />
                </svg>
              </button>
              <button
                onClick={toggleLoved}
                disabled={loving}
                className={`leading-none text-2xl transition-colors disabled:opacity-50 ${book.loved ? 'text-red-400 hover:text-red-300' : 'text-white hover:text-red-300'}`}
                title={book.loved ? 'Loved' : 'Mark as loved'}
              >
                {book.loved ? '♥' : '♡'}
              </button>
              <ListPicker
                bookId={book.id}
                dropUp
                iconClassName="w-5 h-5"
                buttonClassName="text-white hover:text-sky-300 transition-colors"
              />
            </div>
          )}
          {/* Hover-revealed title + author at the bottom of the cover.
              Replaces the always-on labels that used to sit under the
              cover — covers carry their own text, and the user wanted
              the grid to read as pure posters at rest. Pointer-events
              disabled so the action tray (sitting just above) still
              receives hovers/clicks. */}
          <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none ${compact ? 'px-1.5 pt-4 pb-1.5' : 'px-3 pt-8 pb-2.5'}`}>
            <p className={`text-white leading-tight line-clamp-2 ${compact ? 'text-xs' : 'text-sm font-medium'}`}>{book.title}</p>
            {!compact && book.authors?.length > 0 && (
              <p className="text-xs text-white/70 leading-tight line-clamp-1 mt-0.5">{formatAuthors(book.authors)}</p>
            )}
            {!compact && isAudiobook && book.narrators?.length > 0 && (
              <p className="text-xs text-white/55 leading-tight line-clamp-1 mt-0.5">{formatAuthors(book.narrators)}</p>
            )}
          </div>
          {/* Inner-frame ring: drawn via box-shadow inset on a layer ABOVE
              the img (where the inset shadow on the frame itself would be
              hidden behind the img). Pointer-events disabled so the action
              tray and other clickable overlays still receive hovers. */}
          <div className={`pointer-events-none absolute inset-0 ring-2 ring-inset ring-[#ffffff00] group-hover:ring-[#ffffff99] transition-[box-shadow] duration-200 ${compact ? 'rounded-sm' : 'rounded'}`} />
          {/* Caller-supplied overlay anchored INSIDE the cover frame — used
              by ListDetail's SortableBookCard to position its drag handle
              over the cover (not below the title/author block, where the
              wrapper's bounding box would otherwise place a `bottom-*`). */}
          {coverOverlay}
        </div>
      </Link>

      {/* Card-level error surface for quick actions (loved / readlist toggles)
          when neither the rating prompt nor the progress editor is open —
          those blocks render `error` inline themselves. Without this, a
          failed PATCH would silently leave the icon unchanged. */}
      {/* mt-2 (rather than mt-0.5 / mt-1.5) gives the inline content blocks
          breathing room from the cover bottom now that the under-cover
          title/author labels are gone — without the buffer the rating
          prompt and progress editor sit flush against the cover edge. */}
      {!compact && error && !ratingPrompt && !open && (
        <p className="text-xs text-warn mt-2">{error}</p>
      )}

      {!compact && ratingPrompt && (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <StarRating value={null} onChange={handleRate} />
            <button
              onClick={() => setRatingPrompt(false)}
              className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
            >
              skip
            </button>
          </div>
          {error && <p className="text-xs text-warn mt-0.5">{error}</p>}
        </div>
      )}

      {!compact && (book.status === 'reading' || book.status === 'paused') && (
        <div className="mt-2">
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
                {isAudiobook ? (
                  <>
                    <option value="min">h/m elapsed</option>
                    {hasPct && <option value="remaining">h/m remaining</option>}
                  </>
                ) : (
                  <option value="page">pg</option>
                )}
                {hasPct && <option value="pct">%</option>}
              </select>
              {isHMMode ? (
                <div className="flex items-center gap-1 w-full">
                  <input
                    ref={inputRef}
                    type="number" min="0" max="999"
                    value={inputH}
                    onChange={(e) => { setError(null); setInputH(e.target.value); }}
                    placeholder="h"
                    className={`w-12 ${numCls}`}
                  />
                  <span className="text-neutral-500 text-xs">h</span>
                  <input
                    type="number" min="0" max="59"
                    value={inputM}
                    onChange={(e) => { setError(null); setInputM(e.target.value); }}
                    onBlur={(e) => setInputM(clampMinutes(e.target.value))}
                    placeholder="m"
                    className={`w-12 ${numCls}`}
                  />
                  <span className="text-neutral-500 text-xs">m</span>
                </div>
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
