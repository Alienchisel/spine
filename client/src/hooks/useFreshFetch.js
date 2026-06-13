import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefreshTick } from './useRefreshTick.js';
import { useStaleGuard } from './useStaleGuard.js';
import { useLatest } from './useLatest.js';

// Standard "fetch on mount, deps change, and tab refocus" hook —
// composes useRefreshTick + useStaleGuard so individual pages stop
// hand-rolling the same boilerplate (and stop forgetting bits of it
// when they do). Returns { data, setData, loading, error, refetch }.
//
// `setData` is exposed so callers can do optimistic updates (e.g.
// SeriesIndex's loved-toggle flips the row in-place, then api-calls
// to confirm, then rolls back on failure). Identity is stable.
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
  const { key, initialData = null } = options;
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
  const prevKeyRef = useRef({});

  useEffect(() => {
    const epoch = guard.next();
    if (key !== undefined && prevKeyRef.current !== key) {
      setLoading(true);
    }
    prevKeyRef.current = key;
    setError(null);
    fnRef.current()
      .then(d => { if (guard.isFresh(epoch)) setData(d); })
      .catch(e => { if (guard.isFresh(epoch)) setError(e); })
      .finally(() => { if (guard.isFresh(epoch)) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, bump, key, ...deps]);

  const refetch = useCallback(() => setBump(b => b + 1), []);
  return { data, setData, loading, error, refetch };
}
