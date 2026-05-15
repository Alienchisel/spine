import { useEffect } from 'react';
import { useLatest } from './useLatest.js';

// Names the "close popover on mousedown outside" idiom. Pass one ref or
// an array — a mousedown is "outside" if NONE of the refs contain the
// target. Use an array when the trigger and popover are separate DOM
// nodes (e.g. portaled dropdowns in MoreMenu / ListPicker); a single
// wrapper ref is enough when the popover is rendered as an absolute
// child of the trigger's wrapper (SearchHelp / ConditionGuide).
//
// Both `refs` and `handler` are read lazily, so callers can pass inline
// closures and inline arrays without re-subscribing on every render.
//
// `enabled` defaults to true; pass `open` to skip subscribing while
// closed (matches the pattern at every existing site).
export function useClickOutside(refs, handler, enabled = true) {
  const refsRef    = useLatest(refs);
  const handlerRef = useLatest(handler);
  useEffect(() => {
    if (!enabled) return;
    function onMouseDown(e) {
      const list = Array.isArray(refsRef.current) ? refsRef.current : [refsRef.current];
      if (list.some(r => r.current?.contains(e.target))) return;
      handlerRef.current(e);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [enabled]); // refsRef and handlerRef are stable refs read lazily inside the listener
}
