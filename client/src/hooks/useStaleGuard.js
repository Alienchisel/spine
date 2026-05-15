import { useRef, useEffect, useMemo } from 'react';

// Names the generation-counter + unmount-flag idiom used throughout
// Spine for dropping stale fetch responses. Two read patterns:
//
//   useEffect(() => {
//     const e = guard.next();             // bump on entry
//     api.foo().then(d => {
//       if (!guard.isFresh(e)) return;    // skip if a newer effect ran
//       setX(d);                          //   or the component unmounted
//     });
//   }, [deps]);
//
//   function handler() {
//     const e = guard.current();          // peek without bumping
//     api.foo().then(d => {
//       if (!guard.isFresh(e)) return;
//       setX(d);
//     });
//   }
//
// `next()` is what an effect calls on each run — increments and returns
// the new epoch, so any handler's earlier captured epoch (taken via
// `current()`) immediately becomes stale on the next effect run. This
// shares the same counter between effects and handlers, which is the
// shape the codebase already uses (e.g. Library's `genRef.current += 1`
// in the load effect + `const gen = genRef.current` in handleLoadMore).
//
// `isFresh()` also returns false after the component unmounts, so this
// replaces the per-effect `let stale = false; return () => { stale =
// true; }` cleanup-flag pattern as well — useful for catching the
// rare-but-real "unmount without a deps change" case (e.g. rapid route
// navigation tearing down a fetch effect that no later effect run
// would otherwise invalidate).
export function useStaleGuard() {
  const ref = useRef(0);
  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);
  return useMemo(() => ({
    next:    () => ++ref.current,
    current: () => ref.current,
    isFresh: (e) => !unmountedRef.current && e === ref.current,
  }), []);
}
