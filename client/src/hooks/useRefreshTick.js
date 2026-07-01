import { useEffect, useRef, useState } from 'react';

// Returns a counter that increments whenever the user's attention
// returns to the tab — used as a useEffect dep so list/detail pages
// refetch when the user comes back from doing something elsewhere
// (adding a book in BookForm, editing in another tab, asking Claude
// to POST against the API, etc.) without forcing a manual reload.
//
// Two triggers: `visibilitychange` (the reliable signal for tab
// show/hide) and `window focus` (catches alt-tab into the browser
// window when tab visibility didn't actually change). Both gated on
// `document.visibilityState === 'visible'` so we don't fire on hide.
//
// Throttled to at most one tick per 30 seconds. Two roles: (1) still
// coalesces the burst focus+visibilitychange fires on a single tab-
// return gesture, and (2) skips the whole refetch pipeline when the
// user tab-hops rapidly during research — the "I glanced at another
// tab for 5s and came back" pattern that used to force a full re-
// render + image reflow of pages like Loved (200 covers). The 30s
// window is a compromise: long enough that quick tab hops feel
// smooth, short enough that a proper break returns fresh data.
// Paired with the diff-and-skip in useFreshFetch — if a refetch DOES
// fire after 30s, the response is compared against current state and
// setData is skipped when identical, avoiding the reflow even for
// longer-absence returns where the data hasn't actually changed.
export function useRefreshTick() {
  const [tick, setTick] = useState(0);
  const lastFireRef = useRef(Date.now());
  useEffect(() => {
    function fire() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFireRef.current < 30_000) return;
      lastFireRef.current = now;
      setTick(t => t + 1);
    }
    document.addEventListener('visibilitychange', fire);
    window.addEventListener('focus', fire);
    return () => {
      document.removeEventListener('visibilitychange', fire);
      window.removeEventListener('focus', fire);
    };
  }, []);
  return tick;
}
