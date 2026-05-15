import { useEffect } from 'react';
import { useLatest } from './useLatest.js';

// Names the "close popover on Escape" idiom. The handler is read lazily
// so inline closures work without re-subscribing. Most callers also want
// to refocus the trigger button on close — that's left to the handler
// itself rather than baked in, since not every site has a trigger to
// return focus to (e.g. EditionsSection's inline input).
//
// `enabled` defaults to true; pass `open` to skip subscribing while
// closed.
export function useEscapeKey(handler, enabled = true) {
  const handlerRef = useLatest(handler);
  useEffect(() => {
    if (!enabled) return;
    function onKey(e) { if (e.key === 'Escape') handlerRef.current(e); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]); // handlerRef is stable; read lazily inside the listener
}
