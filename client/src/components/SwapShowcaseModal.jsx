import { useEffect, useRef, useState } from 'react';
import { initialsFor } from '../utils.js';

// Pick-to-swap dialog. Opens from the BookDetail / Author page ★ when
// the user tries to add an entity and all five Showcase slots in its
// row are full. Rendering inline (image + rank + label) lets the user
// pick a slot without losing track of which entity they're trying to
// put in; the alternative (bounce to /showcase, remove a pick, come
// back, click ★ again) loses the "I wanted to add THIS one" intent.
//
// The actual swap PATCHes live in the parent so this component stays a
// pure renderer. Items are passed normalized with
//   { id, label, image_path, showcase_position }
// — books pass {label: title, image_path: cover_path}, authors pass
// {label: name, image_path: photo_path}. onPick receives the full item.
export default function SwapShowcaseModal({ open, picks, incomingTitle, onPick, onClose }) {
  // Per-row in-flight state so a fast double-click on the same row
  // can't fire two parallel swap calls before the modal closes.
  const [busyId, setBusyId] = useState(null);
  const dialogRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    document.addEventListener('keydown', onKey);
    // Defer focus past mount so the first row is reachable by keyboard.
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', onKey);
      const target = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (target && typeof target.focus === 'function') {
        requestAnimationFrame(() => target.focus());
      }
    };
  }, [open, onClose]);

  // Reset busy state when the modal opens — a previous failed swap that
  // left busyId set on an unmounted row shouldn't carry into the next
  // open. (Defensive: onPick clears busyId on resolve anyway.)
  useEffect(() => {
    if (open) setBusyId(null);
  }, [open]);

  if (!open) return null;

  async function handlePick(pick) {
    if (busyId != null) return;
    setBusyId(pick.id);
    try {
      await onPick(pick);
    } finally {
      // Parent closes the modal on success — clearing busyId only
      // matters on failure (modal stays open, user can retry).
      setBusyId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Swap a Showcase pick"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl focus:outline-none"
      >
        <p className="text-sm font-semibold text-parchment mb-1">Showcase is full</p>
        <p className="text-xs text-neutral-500 mb-4 leading-relaxed">
          Pick a slot to replace with <span className="text-neutral-300">{incomingTitle}</span>.
        </p>
        <ul className="space-y-1.5">
          {picks.map(p => {
            const isBusy = busyId === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => handlePick(p)}
                  disabled={busyId != null}
                  className="w-full flex items-center gap-3 px-2 py-2 text-left rounded-md transition-colors hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-default"
                >
                  <span className="text-xs font-bold text-leather w-5 flex-shrink-0 tabular-nums text-center select-none">
                    {p.showcase_position}
                  </span>
                  <div className="w-8 h-12 flex-shrink-0 bg-neutral-800 rounded-sm overflow-hidden">
                    {p.image_path ? (
                      // object-top so author portraits keep the head
                      // visible in the narrow thumbnail; books are 2:3
                      // already so this is a no-op for them.
                      <img src={p.image_path} alt="" className="w-full h-full object-cover object-top" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900">
                        <span className="text-[10px] font-bold text-neutral-500 select-none">{initialsFor(p.label)}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-sm text-parchment truncate flex-1">{p.label}</span>
                  <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                    {isBusy ? 'Swapping…' : 'Replace'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busyId != null}
            className="px-3 py-1.5 text-sm rounded-md text-neutral-400 hover:text-neutral-200 transition-colors focus:outline-none focus:ring-2 focus:ring-oak/50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
