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
// Coalesced via a 500ms guard: some browsers fire focus AND
// visibilitychange together on the same gesture, and we don't want
// two back-to-back refetches. Also short-circuits the very first
// render's focus event, which would otherwise duplicate the mount
// fetch.
export function useRefreshTick() {
  const [tick, setTick] = useState(0);
  const lastFireRef = useRef(Date.now());
  useEffect(() => {
    function fire() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFireRef.current < 500) return;
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
