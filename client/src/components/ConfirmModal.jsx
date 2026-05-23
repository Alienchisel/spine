import { createContext, useContext, useState, useRef, useEffect, useCallback, useId } from 'react';

// Promise-based confirm dialog. Mount <ConfirmModalProvider> once at the app
// root; call useConfirm() from any component to get a function that returns
// Promise<boolean>. Drop-in replacement for `window.confirm()` so the
// existing `if (!confirm(...)) return;` pattern works with `await`.
//
//   const confirm = useConfirm();
//   if (!await confirm('Delete this book?')) return;
//   // — or with extra options —
//   if (!await confirm({
//     title:        'Delete building',
//     message:      'This will also delete every room, unit, and shelf inside.',
//     confirmLabel: 'Delete everything',
//   })) return;
//
// Defaults bias toward safety: focus lands on Cancel (so an Enter keypress
// on the focused element cancels rather than confirms a destructive action),
// ESC dismisses, and click-outside dismisses.

const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmModalProvider>');
  return ctx;
}

function normalize(input) {
  if (typeof input === 'string') return { message: input };
  return input || {};
}

export function ConfirmModalProvider({ children }) {
  const [state, setState] = useState(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  // The element that had keyboard focus when the modal opened. On close we
  // refocus it so keyboard users don't get dumped to <body> — particularly
  // important since the modal explicitly moves focus to Cancel on mount.
  const returnFocusRef = useRef(null);
  const titleId = useId();
  const messageId = useId();

  const confirm = useCallback((input) => {
    const opts = normalize(input);
    return new Promise(resolve => {
      // Guard against rapid double-calls: if a prior confirm is still open,
      // resolve it as false (cancel) before swapping in the new one. Without
      // this the first awaiting caller would hang forever when the second
      // setState overwrites its resolve callback.
      setState(prev => {
        if (prev) prev.resolve(false);
        // Capture before the modal renders so the page-focus snapshot
        // reflects what the user had focus on at the call site, not Cancel.
        returnFocusRef.current = document.activeElement;
        return { ...opts, resolve };
      });
    });
  }, []);

  const close = useCallback((result) => {
    if (state) state.resolve(result);
    setState(null);
    // Restore focus to the element that triggered the confirm. The target
    // may have been removed from the DOM (e.g. the delete button on a card
    // that was just deleted) — in that case focus() is a no-op and the
    // browser leaves activeElement on <body>, which is acceptable.
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && typeof target.focus === 'function') {
      // Defer past the unmount so focus lands after React clears the modal.
      requestAnimationFrame(() => target.focus());
    }
  }, [state]);

  useEffect(() => {
    if (!state) return;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      // Focus trap: keep Tab / Shift-Tab cycling between Cancel and Confirm
      // so keyboard users can't accidentally land focus on the page behind
      // the modal. Two buttons → one wrap forward, one wrap back.
      if (e.key !== 'Tab') return;
      const buttons = [cancelRef.current, confirmRef.current].filter(Boolean);
      if (buttons.length === 0) return;
      const idx = buttons.indexOf(document.activeElement);
      if (idx === -1) {
        // Focus has escaped the pair (e.g. user clicked into the page
        // behind via mouse-then-keyboard). Yank it back to Cancel.
        e.preventDefault();
        cancelRef.current?.focus();
        return;
      }
      if (e.shiftKey && idx === 0) {
        e.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (!e.shiftKey && idx === buttons.length - 1) {
        e.preventDefault();
        buttons[0].focus();
      }
    }
    document.addEventListener('keydown', onKey);
    // Defer focus by one tick so the button is mounted.
    requestAnimationFrame(() => cancelRef.current?.focus());
    return () => document.removeEventListener('keydown', onKey);
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={state.title ? titleId : undefined}
          aria-describedby={messageId}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
          <div className="relative w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            {state.title && (
              <p id={titleId} className="text-sm font-semibold text-parchment mb-2">{state.title}</p>
            )}
            <p id={messageId} className="text-sm text-neutral-300 leading-relaxed mb-5 whitespace-pre-wrap">
              {state.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                ref={cancelRef}
                onClick={() => close(false)}
                className="px-3 py-1.5 text-sm rounded-md text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                {state.cancelLabel || 'Cancel'}
              </button>
              <button
                type="button"
                ref={confirmRef}
                onClick={() => close(true)}
                className="px-3 py-1.5 text-sm rounded-md bg-warn/15 text-warn hover:bg-warn/25 transition-colors"
              >
                {state.confirmLabel || 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
