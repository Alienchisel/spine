import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

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
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  async function handleOpen(e) {
    e.preventDefault();
    e.stopPropagation();
    if (open) { setOpen(false); return; }

    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: dropUp ? undefined : rect.bottom + 4,
      bottom: dropUp ? window.innerHeight - rect.top + 4 : undefined,
      right: window.innerWidth - rect.right,
    });

    setOpen(true);
    setLoading(true);
    try {
      const [allLists, ids] = await Promise.all([api.getLists(), api.getBookLists(bookId)]);
      setLists(allLists);
      setMemberIds(new Set(ids));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(e, listId) {
    e.preventDefault();
    e.stopPropagation();
    if (busy.has(listId)) return;
    setBusy(s => new Set([...s, listId]));
    try {
      if (memberIds.has(listId)) {
        await api.removeFromList(listId, bookId);
        setMemberIds(s => { const n = new Set(s); n.delete(listId); return n; });
      } else {
        await api.addToList(listId, bookId);
        setMemberIds(s => new Set([...s, listId]));
      }
    } finally {
      setBusy(s => { const n = new Set(s); n.delete(listId); return n; });
    }
  }

  const inAny = memberIds.size > 0;

  const dropdown = open && pos && createPortal(
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, right: pos.right }}
      className="z-[9999] w-52 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl py-1"
    >
      {loading ? (
        <p className="text-xs text-neutral-600 px-3 py-2">Loading…</p>
      ) : lists.length === 0 ? (
        <div className="px-3 py-2">
          <p className="text-xs text-neutral-600 mb-1">No lists yet.</p>
          <Link to="/lists" className="text-xs text-oak hover:text-leather" onClick={() => setOpen(false)}>
            Create a list →
          </Link>
        </div>
      ) : (
        lists.map(list => {
          const checked = memberIds.has(list.id);
          return (
            <button
              key={list.id}
              onClick={(e) => handleToggle(e, list.id)}
              disabled={busy.has(list.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              <span className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${checked ? 'bg-sky-500 border-sky-500' : 'border-neutral-600'}`}>
                {checked && (
                  <svg viewBox="0 0 10 8" fill="none" className="w-2.5 h-2.5">
                    <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className={`truncate ${checked ? 'text-neutral-200' : 'text-neutral-400'}`}>{list.name}</span>
            </button>
          );
        })
      )}
    </div>,
    document.body
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        title="Add to list"
        className={`leading-none transition-colors ${inAny ? 'text-sky-400' : 'text-neutral-600 hover:text-neutral-400'} ${buttonClassName}`}
      >
        <ListsIcon className={iconClassName} />
      </button>
      {dropdown}
    </>
  );
}
