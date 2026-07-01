import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefreshTick } from './useRefreshTick.js';
import { useStaleGuard } from './useStaleGuard.js';
import { useLatest } from './useLatest.js';

// Deep-equal check for a fetch payload. JSON.stringify is fast enough
// for typical Spine responses (Loved's 200-book grid is ~40 kB — under
// 5 ms round-trip on the least capable device that runs the app), and
// avoids adding a dependency on a real deep-equal library. Falls back
// to reference equality on stringify failure (unlikely — payloads are
// always JSON-safe if they came from an api.* call, but circular refs
// or exotic values in some future call site shouldn't crash the diff).
function isEqualPayload(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}

// Standard "fetch on mount, deps change, and tab refocus" hook —
// composes useRefreshTick + useStaleGuard so individual pages stop
// hand-rolling the same boilerplate (and stop forgetting bits of it
// when they do). Returns { data, setData, loading, error, refetch }.
//
// `setData` is exposed so callers can do optimistic updates (e.g.
// SeriesIndex's loved-toggle flips the row in-place, then api-calls
// to confirm, then rolls back on failure). `setError` is exposed for
// dismissible error banners (Loved's ErrorBanner). Both have stable
// identity.
//
// Behaviour:
//
//   * First mount: loading=true until the first response, data starts
//     at `initialData` (default null).
//   * deps change: re-fetches. When `key` is provided AND differs from
//     the previous run, sets loading=true again — the skeleton-flash
//     path for real navigation (Author's `${id}::${sort}` shape).
//     When `key` is absent or unchanged, keep current data + loading
//     stays false — the silent-refetch path (atomic swap on resolve,
//     no skeleton flash on alt-tab back).
//   * Tab refocus / visibilitychange: re-runs the effect via
//     useRefreshTick's tick. Always treated as a silent refetch
//     (`key` matches by definition, since deps didn't change).
//   * refetch(): imperative re-run, same silent semantics as a tick.
//
// `fn` is held in a ref via useLatest so callers don't need to memo
// it — the effect always invokes the latest closure, but its identity
// doesn't drive re-runs. Drive re-runs with `deps` instead (and `key`
// for the skeleton-flash decision).
//
// Errors propagate as the thrown value (api.js throws Error with
// `.status` and optional `.field` — preserved). Callers needing
// special error handling (Author's 404 → 'notfound' kind) should
// branch on `error?.status` themselves.
export function useFreshFetch(fn, deps = [], options = {}) {
  const { key, initialData = null, wipeOnKeyChange = false } = options;
  const [data, setData]       = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [bump, setBump]       = useState(0);
  const tick   = useRefreshTick();
  const guard  = useStaleGuard();
  const fnRef  = useLatest(fn);
  // Sentinel object so the first run never compares equal to a real
  // key — that way mount always flows through the "is key different"
  // branch without needing a separate mount flag.
  const FIRST_RUN = useRef({}).current;
  const prevKeyRef = useRef(FIRST_RUN);

  // Detect key change DURING RENDER (not in useEffect) so the same
  // commit that ships the new key also shows loading=true. Setting
  // loading in useEffect after a deps change leaves a one-paint
  // window where the previous fetch's data is rendered with the new
  // key — the flash Author's adoption path was specifically designed
  // to avoid. Idiomatic per React's "Adjusting State Based on Props".
  if (key !== undefined && prevKeyRef.current !== key) {
    const isFirstRun = prevKeyRef.current === FIRST_RUN;
    prevKeyRef.current = key;
    if (!loading) setLoading(true);
    // wipeOnKeyChange: opt-in for pages whose render doesn't gracefully
    // gate stale data behind `loading` (BookDetail flashes the previous
    // book's cover/metadata otherwise). Skips the first run since data
    // already starts at initialData via useState init.
    if (wipeOnKeyChange && !isFirstRun) setData(initialData);
  }

  useEffect(() => {
    const epoch = guard.next();
    setError(null);
    fnRef.current()
      .then(d => {
        if (!guard.isFresh(epoch)) return;
        // Diff-and-skip: when the freshly-fetched payload is deep-equal
        // to what we're already showing (the common case on tab-return
        // refetches after inactivity), skip the setData call entirely
        // so React doesn't re-render the tree. This is what preserves
        // scroll position, image identity, and any local state trapped
        // inside cell components (an open MoreMenu, a hover, an inline
        // edit) during silent refetches. Using the functional setData
        // form so we compare against the LATEST state — an in-flight
        // optimistic update should still win over a stale server
        // response.
        setData(prev => isEqualPayload(prev, d) ? prev : d);
      })
      .catch(e => { if (guard.isFresh(epoch)) setError(e); })
      .finally(() => { if (guard.isFresh(epoch)) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, bump, key, ...deps]);

  const refetch = useCallback(() => setBump(b => b + 1), []);
  return { data, setData, loading, error, setError, refetch };
}
