import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';

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

  const confirm = useCallback((input) => {
    const opts = normalize(input);
    return new Promise(resolve => setState({ ...opts, resolve }));
  }, []);

  const close = useCallback((result) => {
    if (state) state.resolve(result);
    setState(null);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
          <div className="relative w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            {state.title && (
              <p className="text-sm font-semibold text-parchment mb-2">{state.title}</p>
            )}
            <p className="text-sm text-neutral-300 leading-relaxed mb-5 whitespace-pre-wrap">
              {state.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                ref={cancelRef}
                onClick={() => close(false)}
                className="px-3 py-1.5 text-sm rounded-md text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                {state.cancelLabel || 'Cancel'}
              </button>
              <button
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
