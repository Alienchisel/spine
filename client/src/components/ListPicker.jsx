import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { useEscapeKey } from '../hooks/useEscapeKey.js';
import { useListMembership } from '../hooks/useListMembership.js';

function ListsIcon({ className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75Zm0 4A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75Zm0 4a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
    </svg>
  );
}

export default function ListPicker({ bookId, dropUp = false, iconClassName = 'w-5 h-5', buttonClassName = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  const { lists, memberIds, busyIds, loading, error, load, toggle } = useListMembership(bookId);

  useClickOutside([buttonRef, dropdownRef], () => setOpen(false), open);
  // Escape closes the popover without losing focus on the trigger, which
  // keeps the keyboard user oriented (Tab continues from where they were
  // before opening).
  useEscapeKey(() => { setOpen(false); buttonRef.current?.focus(); }, open);

  // Scroll-close: portaled popover misaligns from its trigger when the
  // page scrolls, so close it. Inline because it's specific to this
  // shape and the inner-overflow guard is non-obvious. Mirrored in MoreMenu.
  useEffect(() => {
    if (!open) return;
    function onScroll(e) {
      // Internal overflow scroll for a tall list shouldn't close the
      // very menu the user is scrolling.
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open]);

  async function handleOpen(e) {
    e.preventDefault();
    e.stopPropagation();
    if (open) { setOpen(false); return; }

    const rect = buttonRef.current.getBoundingClientRect();
    const dropdownWidth = 208;
    const idealLeft = rect.right - dropdownWidth;
    const left = Math.min(Math.max(idealLeft, 8), window.innerWidth - dropdownWidth - 8);
    setPos({
      top: dropUp ? undefined : rect.bottom + 4,
      bottom: dropUp ? window.innerHeight - rect.top + 4 : undefined,
      left,
    });

    setOpen(true);
    await load();
  }

  async function handleToggle(e, listId) {
    e.preventDefault();
    e.stopPropagation();
    toggle(listId);
  }

  const inAny = memberIds.size > 0;

  const dropdown = open && pos && createPortal(
    <div
      ref={dropdownRef}
      role="menu"
      aria-label="Add to list"
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left }}
      className="z-[9999] w-52 max-h-[80vh] overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1"
    >
      {loading ? (
        <p role="status" className="text-xs text-neutral-600 px-3 py-2">Loading…</p>
      ) : error && lists.length === 0 ? (
        // Load failed and we have nothing to show — error replaces the
        // list content rather than sitting on top of an empty state.
        <p role="alert" className="text-xs text-warn px-3 py-2">{error}</p>
      ) : lists.length === 0 ? (
        <div className="px-3 py-2">
          <p className="text-xs text-neutral-600 mb-1">No lists yet.</p>
          <Link to="/lists" role="menuitem" className="text-xs text-oak hover:text-leather" onClick={() => setOpen(false)}>
            Create a list →
          </Link>
        </div>
      ) : (<>
        {/* Toggle failed but lists are loaded — surface the error above
            the list buttons so the user knows their click didn't take. */}
        {error && <p role="alert" className="text-xs text-warn px-3 py-1.5 border-b border-neutral-800">{error}</p>}
        {lists.map(list => {
          const checked = memberIds.has(list.id);
          return (
            <button
              key={list.id}
              onClick={(e) => handleToggle(e, list.id)}
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
        })}
      </>)}
    </div>,
    document.body
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        title="Add to list"
        aria-label="Add to list"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`leading-none transition-colors ${inAny ? 'text-sky-400' : 'text-neutral-600 hover:text-neutral-400'} ${buttonClassName}`}
      >
        <ListsIcon className={iconClassName} />
      </button>
      {dropdown}
    </>
  );
}
