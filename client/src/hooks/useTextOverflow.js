import { useEffect, useState, useRef } from 'react';

// Watches a text element for vertical overflow against its line-clamp,
// so callers can show a "Show more" toggle when (and only when) the
// rendered text actually exceeds its clamp — not based on a brittle
// character-count proxy. The caller passes `enabled` (true while the
// clamp is active, false once expanded), so we don't fight the unclamped
// state. When disabled, the last-known value is retained — that's the
// signal the toggle button uses to keep showing "Show less" / "Show
// more" without re-measuring on every expand/collapse cycle.
//
// Re-measures on bio/text changes (via the `deps` array) and on layout
// changes (via ResizeObserver — handles viewport resize and any flex/
// grid reflow around the element).
//
// Usage:
//   const [ref, overflowing] = useTextOverflow(!expanded, [text]);
//   <p ref={ref} className={expanded ? '' : 'line-clamp-4'}>{text}</p>
//   {overflowing && <button onClick={toggle}>Show more / less</button>}
export function useTextOverflow(enabled, deps = []) {
  const ref = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      // rAF defers until the next layout pass, so a freshly-mounted
      // element has its scrollHeight resolved before we read it. Without
      // this, the first measurement on mount can fire before the browser
      // has applied the line-clamp and reports scroll == client.
      requestAnimationFrame(() => {
        const node = ref.current;
        if (!node) return;
        setOverflowing(node.scrollHeight > node.clientHeight + 1);
      });
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return [ref, overflowing];
}
