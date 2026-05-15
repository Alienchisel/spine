import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useLatest } from '../hooks/useLatest.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';

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
  const [lists, setLists] = useState([]);
  const [memberIds, setMemberIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(new Set());
  const [error, setError] = useState(null);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  // Stale-response guard for handleOpen. User can open → close → open
  // before the first Promise.all resolves; the first response then writes
  // lists/memberIds for a now-stale open. Each handleOpen bumps the ref
  // and captures its gen; earlier in-flight calls drop their state writes.
  const openGuard = useStaleGuard();
  // `busy` (React state) drives the disabled UI but doesn't commit until
  // the next render — so two synchronous handleToggle calls in the same
  // tick (mobile touch+click pair, programmatic dispatch, repeated event
  // misfires) both see the pre-commit busy and fire duplicate add/remove
  // PUTs. The ref mutates synchronously so the second call sees the
  // first's marker immediately. Mirrors the deletingIdsRef pattern in
  // ReadsSection.
  const busyIdsRef = useRef(new Set());
  // Tracks the current bookId so the spine:book-mutated listener's
  // in-flight getBookLists can drop its setMemberIds when the user has
  // navigated to a different book mid-flight. useLatest keeps it fresh
  // by the time any handler closure reads it.
  const currentBookIdRef = useLatest(bookId);

  // Reset memberIds when the bookId prop changes so the old book's
  // memberships don't briefly color the icon or seed stale check marks
  // before handleOpen's next fetch lands. Without this, navigating
  // between books on BookDetail shows the previous book's "in any list"
  // state until the user opens the picker.
  useEffect(() => {
    setMemberIds(new Set());
  }, [bookId]);

  // Stay in sync with palette-driven (or any external) mutations on
  // this book. The command palette's 'Add to list…' sub-prompt
  // dispatches spine:book-mutated after a successful add; without this
  // listener, ListPicker's cached memberIds would keep its check-marks
  // stale until the dropdown was reopened. Always listens (not just
  // when open) so the cache is current on the next open too.
  useEffect(() => {
    function onMutate(e) {
      const evtBookId = Number(e.detail?.id);
      if (evtBookId !== Number(bookId)) return;
      api.getBookLists(bookId)
        .then(ids => {
          // Drop the response if the user has navigated to a different
          // book in the meantime — without this, an in-flight refetch
          // started while bookId was still X could land setMemberIds on
          // the component now showing Y. Same shape as BookDetail's
          // isStillCurrent pattern.
          if (Number(currentBookIdRef.current) !== evtBookId) return;
          setMemberIds(new Set(ids));
        })
        .catch(() => {});
    }
    window.addEventListener('spine:book-mutated', onMutate);
    return () => window.removeEventListener('spine:book-mutated', onMutate);
  }, [bookId]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onScroll(e) {
      // Skip scrolls inside the dropdown — internal overflow scroll for
      // a tall list shouldn't close the very menu the user is scrolling.
      // Mirrors MoreMenu's scroll-close guard.
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    // Escape closes the popover without losing focus on the trigger,
    // which keeps the keyboard user oriented (Tab continues from where
    // they were before opening).
    function onKey(e) { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
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
    setLoading(true);
    setError(null);
    const epoch = openGuard.next();
    // Promise.allSettled splits the two failure modes: getLists is
    // load-bearing (no lists = nothing to pick from), getBookLists is
    // supplementary (just the check-mark state). With Promise.all, a
    // failed memberships fetch would discard the successfully-loaded
    // lists and surface as "Failed to load lists" — misleading. Now the
    // picker still works on a memberships failure, just without showing
    // which lists this book already belongs to.
    const [listsR, idsR] = await Promise.allSettled([api.getLists(), api.getBookLists(bookId)]);
    // Spinner only flips off for the LATEST open; a stale response that
    // arrives while a newer open is still in flight must leave it on.
    if (!openGuard.isFresh(epoch)) return;
    if (listsR.status === 'fulfilled') {
      setLists(listsR.value);
    } else {
      setLists([]);
      setError('Failed to load lists');
    }
    if (idsR.status === 'fulfilled') {
      setMemberIds(new Set(idsR.value));
    } else {
      // Clear stale memberships from a prior open so the picker doesn't
      // show wrong check-marks; failure is silent (user can still toggle,
      // and addToList is INSERT OR IGNORE so re-adds are safe).
      setMemberIds(new Set());
    }
    setLoading(false);
  }

  async function handleToggle(e, listId) {
    e.preventDefault();
    e.stopPropagation();
    if (busyIdsRef.current.has(listId)) return;
    busyIdsRef.current.add(listId);
    setBusy(s => new Set([...s, listId]));
    setError(null);
    try {
      if (memberIds.has(listId)) {
        await api.removeFromList(listId, bookId);
        setMemberIds(s => { const n = new Set(s); n.delete(listId); return n; });
      } else {
        await api.addToList(listId, bookId);
        setMemberIds(s => new Set([...s, listId]));
      }
    } catch {
      setError('Failed to update list');
    } finally {
      busyIdsRef.current.delete(listId);
      setBusy(s => { const n = new Set(s); n.delete(listId); return n; });
    }
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
          <Link to="/lists" className="text-xs text-oak hover:text-leather" onClick={() => setOpen(false)}>
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
