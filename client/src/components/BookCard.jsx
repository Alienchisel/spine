import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useActionGuard } from '../hooks/useActionGuard.js';
import { realTagNames, initialsFor } from '../utils.js';
import { getModeKey, initialProgressMode, computeProgressPatch, syncProgressInputs, progressDerived, clampMinutes } from './progressMode.js';
import MoreMenu from './MoreMenu.jsx';

const STATUS_BAR = {
  reading:  'bg-oak',
  finished: 'bg-leather',
  unread:   'bg-neutral-600',
};


function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.75 6.774a2.75 2.75 0 0 0-.596.892l-.848 2.047a.75.75 0 0 0 .98.98l2.047-.848a2.75 2.75 0 0 0 .892-.596l4.263-4.263a1.75 1.75 0 0 0 0-2.474ZM3.25 12.25a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5Z" />
    </svg>
  );
}

export default function BookCard({ book: initialBook, onProgressUpdate, compact, coverOverlay, hideActions, fadeUnowned, linkState }) {
  const navigate = useNavigate();
  const [book, setBook] = useState(initialBook);
  const [open, setOpen] = useState(false);
  const loveGuard = useActionGuard();
  const listGuard = useActionGuard();
  const [inputVal, setInputVal] = useState('');
  const [inputH, setInputH] = useState('');
  const [inputM, setInputM] = useState('');
  const [mode, setMode] = useState(() => {
    const audio = initialBook.format === 'audiobook';
    const initialHasPct = audio ? Boolean(initialBook.duration_minutes) : Boolean(initialBook.page_count);
    return initialProgressMode(localStorage.getItem(getModeKey(initialBook.id)), audio, initialHasPct);
  });
  const saveGuard = useActionGuard();
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { setBook(initialBook); }, [initialBook]);

  const { isAudiobook, hasPct, pct } = progressDerived(book);


  // Re-clamp the persisted mode when the book's format or totals change
  // out from under us at runtime — e.g., format toggled physical→audiobook,
  // or page_count cleared while mode was 'pct'. Mount-time hydration
  // already runs initialProgressMode, but mount-time alone leaves a
  // stale mode if the same component instance receives an updated book.
  // Reads from localStorage so the user's last-selected preference is
  // honoured if the current state can support it again later. When the
  // resolved mode differs from current, also refresh the inputs so an
  // already-open inline editor doesn't render with a value typed for
  // the old mode. (Closed-editor case: this is harmless — inputs are
  // off-screen, and toggleEditor re-syncs them on the next open.)
  // mode/book/pct intentionally absent from deps; only fire on the
  // invalidation triggers.
  useEffect(() => {
    const next = initialProgressMode(localStorage.getItem(getModeKey(book.id)) ?? mode, isAudiobook, hasPct);
    if (next === mode) return;
    setMode(next);
    const inputs = syncProgressInputs({ book, isAudiobook, mode: next, pct });
    setInputVal(inputs.inputVal);
    setInputH(inputs.inputH);
    setInputM(inputs.inputM);
  }, [isAudiobook, hasPct, book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Split from toggleEditor so the MoreMenu can request an unconditional
  // open (toggling would close the editor if it happened to already be
  // open behind the popover). toggleEditor still owns the pencil-button
  // open/close behaviour.
  function openEditor() {
    setError(null);
    const inputs = syncProgressInputs({ book, isAudiobook, mode, pct });
    setInputVal(inputs.inputVal);
    setInputH(inputs.inputH);
    setInputM(inputs.inputM);
    setOpen(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function toggleEditor(e) {
    e.preventDefault();
    if (open) { setOpen(false); return; }
    openEditor();
  }

  function changeMode(m) {
    setError(null);
    setMode(m);
    localStorage.setItem(getModeKey(book.id), m);
    const inputs = syncProgressInputs({ book, isAudiobook, mode: m, pct });
    setInputVal(inputs.inputVal);
    setInputH(inputs.inputH);
    setInputM(inputs.inputM);
  }

  const isHMMode = isAudiobook && mode !== 'pct';
  const isEmpty = isHMMode ? (inputH === '' && inputM === '') : inputVal === '';


  async function handleSubmit(e) {
    e.preventDefault();
    if (isEmpty) return;

    // Compute the patch BEFORE arming the spinner. Splitting the
    // pure-compute step from the in-flight step avoids a stuck-spinner
    // footgun on validation early-returns. See computeProgressPatch.
    const { patchData, error: patchError } = computeProgressPatch({
      book, isAudiobook, mode, inputVal, inputH, inputM,
    });
    if (patchError) { setError(patchError); return; }

    // Double-fire near the page_count boundary could double-trigger the
    // auto-finish reads-row insert.
    if (!saveGuard.begin()) return;
    setError(null);
    try {
      const updated = await api.patchBook(book.id, patchData);
      // Inline until a second surface needs auto-finish — progressMode.js stays the home for shared progress logic.
      const isComplete = isAudiobook
        ? (updated.duration_minutes > 0 && updated.current_minutes >= updated.duration_minutes)
        : (updated.page_count > 0 && updated.current_page >= updated.page_count);
      if (isComplete && updated.status === 'reading') {
        // Mirror BookDetail.handleFinish's prev-owned-aware date default:
        // owned-and-just-finished → today; previously-owned historical
        // entries → leave null so the user can fill in if they remember.
        const today = new Date().toLocaleDateString('en-CA');
        const dateFinished = updated.date_finished
          || (updated.previously_owned ? null : today);
        const finished = await api.updateBook(book.id, {
          ...updated,
          status: 'finished',
          date_finished: dateFinished,
          tags: realTagNames(updated.tags),
        });
        onProgressUpdate?.(finished);
        // The card unmounts the moment the parent (Library) re-filters
        // the now-finished book off the Reading tab — so a local rating
        // prompt would vanish before the user sees it. Send the user to
        // BookDetail with a `justFinished` flag; that page reads it and
        // shows the rating prompt there, on a surface that survives.
        navigate(`/books/${book.id}`, { state: { ...(linkState || {}), justFinished: true } });
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
      saveGuard.end();
    }
  }

  // Buttons inside the hover tray have no disabled prop (they live behind
  // a fade-in tray and the user can mash them), so two same-tick clicks
  // both read book.loved=stale and fire duplicate PATCHes resolving to
  // the same target value — idempotent at the DB level but bumps
  // updated_at twice and pollutes Recently updated.
  async function toggleLoved(e) {
    e.preventDefault();
    if (!loveGuard.begin()) return;
    setError(null);
    try {
      const updated = await api.patchBook(book.id, { loved: book.loved ? 0 : 1 });
      setBook(updated);
      onProgressUpdate?.(updated);
    } catch {
      setError('Failed to update loved');
    } finally {
      loveGuard.end();
    }
  }

  async function toggleReadlist(e) {
    e.preventDefault();
    if (!listGuard.begin()) return;
    setError(null);
    try {
      const updated = await api.patchBook(book.id, { on_readlist: book.on_readlist ? 0 : 1 });
      setBook(updated);
      onProgressUpdate?.(updated);
    } catch {
      setError('Failed to update readlist');
    } finally {
      listGuard.end();
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
  }

  // hasPct gates the `${pct}%` branch on both sides — without the gate,
  // an audiobook with logged minutes but no duration_minutes (or a paper
  // book with current_page but no page_count) would interpolate a null
  // pct and render "null%". Fall back to absolute progress in those cases:
  // h/m elapsed for audiobooks, "p. N" for paper.
  const audioMins = book.current_minutes;
  const audioElapsed = audioMins != null
    ? (audioMins >= 60 ? `${Math.floor(audioMins / 60)}h ${audioMins % 60}m` : `${audioMins}m`)
    : null;
  const progressLabel = isAudiobook
    ? (audioMins != null ? (hasPct ? `${pct}%` : audioElapsed) : null)
    : (book.current_page != null ? (hasPct ? `${pct}%` : `p. ${book.current_page}`) : null);

  const numCls = 'bg-neutral-800 border border-neutral-700 text-parchment text-xs rounded px-2 py-1 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  // Archived books are dimmed and slightly desaturated so the state reads at
  // a glance — used on the Archived tab and on search-result cards (search
  // surfaces archived items so users can find them to un-archive).
  // Card-level dimming. Archived takes precedence (stronger statement);
  // otherwise, on wishlist surfaces (fadeUnowned=true) unowned copies fade
  // so a mixed list communicates ownership at a glance without on-cover
  // text or chrome. Custom and Internet provenance are left to the corner
  // glyphs — the boolean here is just `book.owned`.
  const dimming = book.archived
    ? 'opacity-60 saturate-50'
    : (fadeUnowned && !book.owned ? 'opacity-55 saturate-50' : '');

  // In edit-mode contexts (hideActions=true) the cover should not be a
  // navigation target — the tap/click semantics are owned by the drag
  // handle. Without this, a click on the handle still bubbles to the
  // wrapping <Link> (button.preventDefault stops the button default but
  // doesn't stop propagation), and after a real drag-and-release the
  // browser fires a click on the drop target's link too, both routing
  // away from the edit screen. Swap to a non-navigating <div> instead.
  const CoverWrapper      = hideActions ? 'div' : Link;
  const coverWrapperProps = hideActions
    ? { className: 'group block' }
    : { to: `/books/${book.id}`, state: linkState, className: 'group block' };
  const coverTitle = [
    book.title,
    book.authors?.map(a => a.name).join(', '),
    isAudiobook && book.narrators?.length > 0 ? `read by ${book.narrators.map(n => n.name).join(', ')}` : null,
  ].filter(Boolean).join(' — ');
  return (
    <div onKeyDown={handleKeyDown} className={`transition-[background-color] ease-out duration-150 ${compact ? '' : 'bg-card rounded-lg p-1.5'} ${dimming}`}>
      <CoverWrapper {...coverWrapperProps} title={coverTitle}>
        {/* Hover signal: a 2px white inset frame on the cover. Implemented
            via an absolute-positioned overlay sibling AFTER the img so the
            box-shadow paints above the image content — `box-shadow: inset`
            on the frame itself would render below the img (per the CSS
            painting order: bg → inset shadow → content) and be invisible
            on covers whose artwork fills the frame. */}
        <div className={`relative bg-neutral-800 overflow-hidden ${compact ? 'aspect-[2/3] rounded-sm' : 'aspect-[2/3] rounded shadow-lg'}`}>
          {book.cover_path ? (
            <img
              src={book.cover_path}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 bg-gradient-to-br from-neutral-700 to-neutral-900 gap-2">
              <span className="text-5xl font-bold text-neutral-500 select-none leading-none tracking-wide">
                {initialsFor(book.title)}
              </span>
              <span className="text-xs text-neutral-500 font-medium leading-tight line-clamp-3 text-center">{book.title}</span>
            </div>
          )}
          {Boolean(book.is_custom) && (
            <div className="absolute top-1.5 left-1.5 bg-black/75 text-leather text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm leading-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              ✦
            </div>
          )}
          {book.acquisition_source === 'Internet' && (
            // Provenance glyph for free/downloaded copies (Internet-sourced
            // ebooks and online manga). Mirrors the ✦ custom badge in shape
            // and visibility (hover-only, top corner) but anchors right so
            // it doesn't collide if a book is both custom and Internet.
            <div
              title="Internet-sourced"
              className="absolute top-1.5 right-1.5 bg-black/75 text-neutral-300 text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm leading-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
            >
              ↓
            </div>
          )}
          {book.status === 'reading' && pct !== null ? (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-neutral-700">
              <div className="h-full bg-oak transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${STATUS_BAR[book.status]}`} />
          )}
          {!compact && !hideActions && (
            // Self-contained dark tray that holds the action icons. The
            // whole tray (rectangle + contents) fades in together on hover
            // — at rest the cover is fully uncluttered. Active state
            // (loved, on_readlist) still expresses via colour once the tray
            // is visible. Hidden in edit-mode contexts (hideActions=true)
            // where the drag handle is the only intended affordance and
            // these buttons would compete with it for the same anchor.
            <div className="absolute inset-x-3 bottom-3 flex justify-center items-center gap-4 px-3 py-1.5 bg-black/80 backdrop-blur-sm rounded-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={toggleReadlist}
                disabled={listGuard.busy}
                className={`leading-none transition-colors disabled:opacity-50 ${book.on_readlist ? 'text-sky-400 hover:text-sky-300' : 'text-white hover:text-sky-300'}`}
                title={book.on_readlist ? 'On readlist' : 'Add to readlist'}
                aria-label={`${book.on_readlist ? 'Remove from readlist' : 'Add to readlist'}: ${book.title}`}
                aria-pressed={!!book.on_readlist}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
                  <path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v12.5a.75.75 0 0 1-1.18.617L8 12.21l-4.82 3.657A.75.75 0 0 1 2 15.25V2.75Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={toggleLoved}
                disabled={loveGuard.busy}
                className={`leading-none text-2xl transition-colors disabled:opacity-50 ${book.loved ? 'text-red-400 hover:text-red-300' : 'text-white hover:text-red-300'}`}
                title={book.loved ? 'Loved' : 'Mark as loved'}
                aria-label={`${book.loved ? 'Remove from loved' : 'Mark as loved'}: ${book.title}`}
                aria-pressed={!!book.loved}
              >
                {book.loved ? '♥' : '♡'}
              </button>
              <MoreMenu
                book={book}
                dropUp
                iconClassName="w-5 h-5"
                onOpenProgress={openEditor}
                returnState={linkState}
              />
            </div>
          )}
          {/* No on-cover text overlay. Title / author / narrator are
              available via the Link's `title` attribute (native browser
              tooltip on long hover) and via click-through to BookDetail.
              Keeping the cover face uncluttered was the explicit ask. */}
          {/* Inner-frame ring: drawn via box-shadow inset on a layer ABOVE
              the img (where the inset shadow on the frame itself would be
              hidden behind the img). Pointer-events disabled so the action
              tray and other clickable overlays still receive hovers. */}
          <div className={`pointer-events-none absolute inset-0 ring-2 ring-inset ring-binding/25 group-hover:ring-[#ffffff99] transition-[box-shadow] duration-200 ${compact ? 'rounded-sm' : 'rounded'}`} />
          {/* Caller-supplied overlay anchored INSIDE the cover frame — used
              by ListDetail's SortableBookCard to position its drag handle
              over the cover (not below the title/author block, where the
              wrapper's bounding box would otherwise place a `bottom-*`). */}
          {coverOverlay}
        </div>
      </CoverWrapper>

      {/* Card-level error surface for quick actions (loved / readlist toggles)
          when neither the rating prompt nor the progress editor is open —
          those blocks render `error` inline themselves. Without this, a
          failed PATCH would silently leave the icon unchanged. */}
      {/* mt-2 (rather than mt-0.5 / mt-1.5) gives the inline content blocks
          breathing room from the cover bottom now that the under-cover
          title/author labels are gone — without the buffer the rating
          prompt and progress editor sit flush against the cover edge. */}
      {!compact && error && !open && (
        <p role="alert" className="text-xs text-warn mt-2">{error}</p>
      )}

      {!compact && book.status === 'reading' && (
        <div className="mt-2">
          <button
            type="button"
            onClick={toggleEditor}
            aria-label={`${progressLabel ?? 'Set progress'}: ${book.title}`}
            className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
          >
            <span>{progressLabel ?? 'Set progress…'}</span>
            <span className="text-neutral-700 hover:text-neutral-400 transition-colors"><PencilIcon /></span>
          </button>
          {/* When a story inside this collection is currently reading,
              surface its title under the progress label so the Reading
              tab tells you which story you're in. */}
          {book.current_story && (
            <p className="text-[10px] text-neutral-600 mt-0.5 truncate" title={book.current_story.title}>
              &ldquo;{book.current_story.title}&rdquo;
            </p>
          )}

          {open && error && (
            <p role="alert" className="mt-1.5 text-xs text-warn">{error}</p>
          )}
          {open && (
            // Framed editor: gives the form a discrete control area
            // distinct from the surrounding card text, so the select / input /
            // buttons read as one widget rather than four floating fragments.
            <form onSubmit={handleSubmit} className="mt-1.5 bg-neutral-900/60 border border-neutral-800 rounded-md p-1.5 flex gap-1.5 items-center flex-wrap">
              <select
                value={mode}
                onChange={(e) => changeMode(e.target.value)}
                aria-label="Progress unit"
                className="bg-neutral-800 border border-neutral-700 text-neutral-400 text-[10px] uppercase tracking-wider rounded px-1.5 py-1 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors"
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
                    aria-label="Hours"
                    className={`w-12 text-sm ${numCls}`}
                  />
                  <span className="text-neutral-500 text-xs">h</span>
                  <input
                    type="number" min="0" max="59"
                    value={inputM}
                    onChange={(e) => { setError(null); setInputM(e.target.value); }}
                    onBlur={(e) => setInputM(clampMinutes(e.target.value))}
                    placeholder="m"
                    aria-label="Minutes"
                    className={`w-12 text-sm ${numCls}`}
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
                  aria-label={mode === 'pct' ? 'Percent complete' : 'Current page'}
                  className={`flex-1 min-w-[3rem] text-sm ${numCls}`}
                />
              )}
              <button
                type="submit"
                disabled={saveGuard.busy || isEmpty}
                aria-label={`${saveGuard.busy ? 'Saving progress' : 'Save progress'}: ${book.title}`}
                className="text-sm bg-binding hover:bg-binding/80 motion-safe:active:scale-[0.98] disabled:opacity-60 text-parchment px-2.5 py-1 rounded transition-[transform,background-color] ease-out duration-150"
              >
                {saveGuard.busy ? '…' : '✓'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={`Close progress editor for ${book.title}`}
                className="text-sm text-neutral-600 hover:text-neutral-400 px-1 py-1 transition-colors"
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
