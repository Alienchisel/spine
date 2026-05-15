import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useConfirm } from './ConfirmModal.jsx';

// Letterboxd-style 'more actions' button for BookCard's hover-tray
// (the third slot, alongside readlist and loved). Opens a portal-
// rendered menu with Add-to-lists / Edit / Delete. Phase 1 of the
// card actions menu — status mutations, rating, and archive can layer
// in later.
//
// Architecture mirrors ListPicker's pattern (portal popover, fixed
// positioning relative to the trigger, mousedown/scroll/Escape close
// handlers). The 'Add to lists' branch opens a sub-state within the
// same menu rather than nesting a separate ListPicker popover — keeps
// the visual model simple and the keyboard contract one-level deep.
//
// Mutations dispatch two events so other surfaces stay in sync:
//   - spine:book-mutated  — fired after list add/remove. BookDetail
//     and ListPicker listen for this and refetch.
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

export default function MoreMenu({ book, dropUp = false, iconClassName = 'w-5 h-5', buttonClassName = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [subPrompt, setSubPrompt] = useState(null);  // null | 'add-to-lists'
  const [lists, setLists] = useState([]);
  const [memberIds, setMemberIds] = useState(new Set());
  const [loadingLists, setLoadingLists] = useState(false);
  const [busy, setBusy] = useState(new Set());
  // Synchronous mirror of busy — state setters don't commit until the
  // next render, so two same-tick toggle clicks on the same list both
  // see busy as empty and fire duplicate add/remove PUTs. Mirrors the
  // busyIdsRef pattern in ListPicker.
  const busyIdsRef = useRef(new Set());
  const [error, setError] = useState(null);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  // Stale-response guard on the lists fetch — rapid open/close before
  // the first response resolves shouldn't let an older response
  // overwrite a newer state.
  const openGenRef = useRef(0);
  const navigate = useNavigate();
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (buttonRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onScroll() { setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') {
      // Inside a sub-prompt, Escape returns to the root menu; from
      // the root menu, Escape closes the whole popover.
      if (subPrompt) setSubPrompt(null);
      else { setOpen(false); buttonRef.current?.focus(); }
    }}
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, subPrompt]);

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
    setError(null);
  }

  async function openListsSubPrompt(e) {
    e.preventDefault();
    e.stopPropagation();
    setSubPrompt('add-to-lists');
    setLoadingLists(true);
    setError(null);
    const gen = ++openGenRef.current;
    const [listsR, idsR] = await Promise.allSettled([
      api.getLists(),
      api.getBookLists(book.id),
    ]);
    if (gen !== openGenRef.current) return;
    if (listsR.status === 'fulfilled') setLists(listsR.value);
    else { setLists([]); setError('Failed to load lists'); }
    if (idsR.status === 'fulfilled') setMemberIds(new Set(idsR.value));
    else setMemberIds(new Set());
    setLoadingLists(false);
  }

  async function toggleList(e, listId) {
    e.preventDefault();
    e.stopPropagation();
    if (busyIdsRef.current.has(listId)) return;
    busyIdsRef.current.add(listId);
    setBusy(s => new Set([...s, listId]));
    setError(null);
    try {
      if (memberIds.has(listId)) {
        await api.removeFromList(listId, book.id);
        setMemberIds(s => { const n = new Set(s); n.delete(listId); return n; });
      } else {
        await api.addToList(listId, book.id);
        setMemberIds(s => new Set([...s, listId]));
      }
      window.dispatchEvent(new CustomEvent('spine:book-mutated', { detail: { id: book.id } }));
    } catch {
      setError('Failed to update list');
    } finally {
      busyIdsRef.current.delete(listId);
      setBusy(s => { const n = new Set(s); n.delete(listId); return n; });
    }
  }

  function handleEdit(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    navigate(`/books/${book.id}/edit`);
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
      window.dispatchEvent(new CustomEvent('spine:book-deleted', { detail: { id: book.id } }));
    } catch {
      // Phase 1 swallows delete errors silently — confirm flow already
      // closed the menu. Future: surface via a toast or BookCard error.
    }
  }

  const dropdown = open && pos && createPortal(
    <div
      ref={dropdownRef}
      role="menu"
      aria-label={subPrompt === 'add-to-lists' ? 'Add to list' : 'Book actions'}
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left }}
      className="z-[9999] w-56 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1"
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
                  disabled={busy.has(list.id)}
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
          <button type="button" onClick={openListsSubPrompt} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            Add to lists…
          </button>
          <button type="button" onClick={handleEdit} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            Edit book…
          </button>
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
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className={`leading-none transition-colors text-white hover:text-neutral-300 ${buttonClassName}`}
      >
        <DotsIcon className={iconClassName} />
      </button>
      {dropdown}
    </>
  );
}
