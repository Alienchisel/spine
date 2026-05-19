import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { realTagNames, labelForPath } from '../utils.js';
import { useConfirm } from './ConfirmModal.jsx';
import StarRating from './StarRating.jsx';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { useEscapeKey } from '../hooks/useEscapeKey.js';
import { useListMembership } from '../hooks/useListMembership.js';
import { dispatchSpineEvent } from '../hooks/useSpineEvent.js';

// Letterboxd-style 'more actions' button for BookCard's hover-tray
// (the third slot, alongside readlist and loved). Opens a portal-
// rendered menu with status mutations + Add-to-lists / Edit / Delete.
//
// Architecture mirrors ListPicker's pattern (portal popover, fixed
// positioning relative to the trigger, mousedown/scroll/Escape close
// handlers). The 'Add to lists' branch opens a sub-state within the
// same menu rather than nesting a separate ListPicker popover — keeps
// the visual model simple and the keyboard contract one-level deep.
// The lists/memberships/toggle logic is shared with ListPicker via
// useListMembership.
//
// Status mutations (Mark as finished / reading / unread) hit
// api.updateBook (PUT — status isn't in the PATCH whitelist) and
// rely on updateBook's finish-transition magic for the reads-row
// auto-insert and read_count auto-increment. Mirrors BookDetail's
// handleFinish payload shape: today-default on date_finished
// (skipped for previously_owned books, since those are typically
// historical reads with unknown dates), today-default on date_started
// when moving into 'reading'.
//
// Mutations dispatch two events so other surfaces stay in sync:
//   - spine:book-mutated  — fired after list add/remove and after
//     status mutations. BookDetail / ListPicker / Library all listen
//     and refetch the affected book (or its sub-data).
//   - spine:book-deleted  — fired after successful api.deleteBook.
//     Library listens and removes the book from its visible list
//     without a refetch round-trip.

function DotsIcon({ className }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <circle cx="3"  cy="8" r="1.5" />
      <circle cx="8"  cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}

export default function MoreMenu({ book, dropUp = false, iconClassName = 'w-5 h-5', buttonClassName = '', onOpenProgress, returnState }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [subPrompt, setSubPrompt] = useState(null);  // null | 'add-to-lists'
  // Optimistic local rating: lets the star widget react instantly to
  // a click even though the PUT round-trip + Library refetch takes
  // ~100-300ms before book.rating reflects the new value. Reset to
  // book.rating whenever the prop changes (e.g. after the refetch,
  // or if the card swapped to a different book).
  const [localRating, setLocalRating] = useState(book.rating ?? null);
  useEffect(() => { setLocalRating(book.rating ?? null); }, [book.rating, book.id]);
  // Inline error for actions that close the menu before completing
  // (status change / archive / delete). The menu has no other render
  // slot for feedback, so the button icon swaps to a '!' with the
  // message on `title=`. Auto-clears after a few seconds so the badge
  // doesn't sit forever on a card the user has stopped interacting with.
  const [actionError, setActionError] = useState(null);
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(t);
  }, [actionError]);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const confirm = useConfirm();
  const { lists, memberIds, busyIds, loading: loadingLists, error, load, toggle, clearError } = useListMembership(book.id, {
    onToggled: () => dispatchSpineEvent('spine:book-mutated', { id: book.id }),
  });

  useClickOutside([buttonRef, dropdownRef], () => setOpen(false), open);
  // Inside a sub-prompt, Escape returns to the root menu; from the root
  // menu, Escape closes the whole popover and returns focus to the
  // trigger.
  useEscapeKey(() => {
    if (subPrompt) setSubPrompt(null);
    else { setOpen(false); buttonRef.current?.focus(); }
  }, open);

  // Scroll-close: portaled popover misaligns from its trigger when the
  // page scrolls. Inner-overflow scroll is excluded so scrolling the
  // sub-prompt list doesn't close the menu around it. Mirrored in ListPicker.
  useEffect(() => {
    if (!open) return;
    function onScroll(e) {
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open]);

  function handleOpen(e) {
    e.preventDefault();
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 224;
    const idealLeft = rect.right - menuWidth;
    const left = Math.min(Math.max(idealLeft, 8), window.innerWidth - menuWidth - 8);
    setPos({
      top:    dropUp ? undefined : rect.bottom + 4,
      bottom: dropUp ? window.innerHeight - rect.top + 4 : undefined,
      left,
    });
    setOpen(true);
    setSubPrompt(null);
    // Opening the menu acknowledges the prior error — drop the badge
    // so it doesn't sit through subsequent interactions.
    setActionError(null);
    clearError();
  }

  async function openListsSubPrompt(e) {
    e.preventDefault();
    e.stopPropagation();
    setSubPrompt('add-to-lists');
    await load();
  }

  async function toggleList(e, listId) {
    e.preventDefault();
    e.stopPropagation();
    toggle(listId);
  }

  // Apply a rating change via a full PUT. Same payload shape as
  // changeStatus — joined arrays flattened to name lists, virtual
  // tags filtered. Optimistic local update so the stars react
  // instantly; rolled back on error.
  async function handleRate(rating) {
    const prior = book.rating ?? null;
    setLocalRating(rating);
    try {
      await api.updateBook(book.id, {
        ...book,
        authors:     book.authors?.map(a => a.name) ?? [],
        narrators:   book.narrators?.map(n => n.name) ?? [],
        translators: book.translators?.map(t => t.name) ?? [],
        tags:        realTagNames(book.tags),
        rating,
      });
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
    } catch {
      setLocalRating(prior);
      setActionError('Failed to save rating. Try again.');
    }
  }

  // Apply a status change via a full PUT. The whole `book` object is
  // spread in so the other bookColumns survive the round-trip (PUT
  // overwrites every bookColumn, so omitting one would null it).
  // Mirrors BookDetail's handleFinish payload shape.
  async function changeStatus(e, nextStatus) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    clearError();
    const today = new Date().toLocaleDateString('en-CA');
    let payload = {
      ...book,
      authors:     book.authors?.map(a => a.name) ?? [],
      narrators:   book.narrators?.map(n => n.name) ?? [],
      translators: book.translators?.map(t => t.name) ?? [],
      tags:        realTagNames(book.tags),
      status:      nextStatus,
    };
    if (nextStatus === 'finished') {
      // Auto-fill date_finished unless already set or previously_owned
      // (historical reads with unknown finish dates — keep null so the
      // user can fill in if they remember).
      payload.date_finished = book.date_finished
        || (book.previously_owned ? null : today);
    }
    if (nextStatus === 'reading' && !book.date_started) {
      payload.date_started = today;
    }
    try {
      await api.updateBook(book.id, payload);
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
    } catch {
      setActionError('Failed to update status. Try again.');
    }
  }

  function handleEdit(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    // Prefer the parent's linkState — it carries the rich entity-aware
    // label the rest of the card uses (list name, author name, browse
    // facet value), where labelForPath would degrade to the index
    // label ("Lists", "Authors") and disagree with the path. Fall back
    // to a computed state for callers that don't pass one.
    const state = returnState ?? { from: labelForPath(pathname), fromPath: pathname + search };
    navigate(`/books/${book.id}/edit`, { state });
  }

  // Surface BookCard's inline progress editor from the menu — useful as
  // a keyboard-driven entry point when the cover's pencil button is
  // hover-revealed and hard to reach without a pointer. The editor is
  // owned by BookCard (which holds the form state); the parent passes
  // an opener callback in.
  function handleOpenProgress(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    onOpenProgress?.();
  }

  // Archive / Restore. PATCH-based (archived is in the patchBook
  // whitelist; the backend also auto-clears on_readlist when archiving).
  async function handleArchive(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    try {
      await api.patchBook(book.id, { archived: !book.archived });
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
    } catch {
      setActionError(book.archived
        ? 'Failed to restore from archive. Try again.'
        : 'Failed to archive book. Try again.');
    }
  }

  async function handleDelete(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    const ok = await confirm({
      title:        'Delete book',
      message:      `Delete "${book.title}"? This is permanent.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.deleteBook(book.id);
      dispatchSpineEvent('spine:book-deleted', { id: book.id });
    } catch {
      setActionError('Failed to delete book. Try again.');
    }
  }

  const dropdown = open && pos && createPortal(
    <div
      ref={dropdownRef}
      role="menu"
      aria-label={subPrompt === 'add-to-lists' ? 'Add to list' : 'Book actions'}
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left }}
      className="z-[9999] w-56 max-h-[80vh] overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1"
    >
      {subPrompt === 'add-to-lists' ? (
        <>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSubPrompt(null); }}
            className="w-full px-3 py-1.5 text-left text-[11px] text-neutral-500 hover:text-neutral-300 border-b border-neutral-800"
          >
            ← Back
          </button>
          {error && <p role="alert" className="text-xs text-warn px-3 py-1.5 border-b border-neutral-800">{error}</p>}
          {loadingLists ? (
            <p role="status" className="text-xs text-neutral-600 px-3 py-2">Loading…</p>
          ) : lists.length === 0 ? (
            <div className="px-3 py-2">
              <p className="text-xs text-neutral-600 mb-1">No lists yet.</p>
              <Link to="/lists" onClick={() => setOpen(false)} className="text-xs text-oak hover:text-leather">
                Create a list →
              </Link>
            </div>
          ) : (
            lists.map(list => {
              const checked = memberIds.has(list.id);
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={(e) => toggleList(e, list.id)}
                  disabled={busyIds.has(list.id)}
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-800 transition-colors disabled:opacity-50"
                >
                  <span className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${checked ? 'bg-sky-500 border-sky-500' : 'border-neutral-600'}`}>
                    {checked && (
                      <svg viewBox="0 0 10 8" fill="none" className="w-2.5 h-2.5">
                        <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={`truncate ${checked ? 'text-neutral-200' : 'text-neutral-400'}`} title={list.name}>{list.name}</span>
                </button>
              );
            })
          )}
        </>
      ) : (
        <>
          {/* Inline star rating — clicks fire optimistic PUTs; the menu
              stays open so the user can adjust further or move on to
              another item. onMouseDown on the wrapper stops the outside-
              click handler (registered on document.mousedown) from
              firing on the dead space between stars. */}
          <div
            className="px-3 py-2 border-b border-neutral-800 flex justify-center"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <StarRating value={localRating} onChange={handleRate} size="text-3xl" />
          </div>
          {onOpenProgress && book.status === 'reading' && (
            <button type="button" onClick={handleOpenProgress} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Update progress…
            </button>
          )}
          {book.status !== 'finished' && (
            <button type="button" onClick={(e) => changeStatus(e, 'finished')} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Mark as finished
            </button>
          )}
          {book.status !== 'reading' && (
            <button type="button" onClick={(e) => changeStatus(e, 'reading')} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Mark as reading
            </button>
          )}
          {book.status !== 'unread' && (
            <button type="button" onClick={(e) => changeStatus(e, 'unread')} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Mark as unread
            </button>
          )}
          <div className="my-1 border-t border-neutral-800" />
          <button type="button" onClick={openListsSubPrompt} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            Add to lists…
          </button>
          <button type="button" onClick={handleEdit} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            Edit book…
          </button>
          <button type="button" onClick={handleArchive} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            {book.archived ? 'Restore from archive' : 'Archive book'}
          </button>
          <div className="my-1 border-t border-neutral-800" />
          <button type="button" onClick={handleDelete} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-warn hover:bg-warn/10 transition-colors">
            Delete book…
          </button>
        </>
      )}
    </div>,
    document.body
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        aria-label={actionError ? `${actionError} Click to retry.` : 'More actions'}
        aria-haspopup="menu"
        aria-expanded={open}
        title={actionError ?? 'More actions'}
        className={`leading-none transition-colors ${
          actionError ? 'text-warn hover:text-warn/80' : 'text-white hover:text-neutral-300'
        } ${buttonClassName}`}
      >
        {actionError
          ? <span aria-hidden="true" className={`inline-flex items-center justify-center font-bold ${iconClassName}`}>!</span>
          : <DotsIcon className={iconClassName} />}
      </button>
      {dropdown}
    </>
  );
}
