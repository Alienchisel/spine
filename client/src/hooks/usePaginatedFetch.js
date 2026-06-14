import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefreshTick } from './useRefreshTick.js';
import { useStaleGuard } from './useStaleGuard.js';
import { useLatest } from './useLatest.js';

// Paginated equivalent of useFreshFetch — for endpoints that return
// { items, total } (plus optional metadata fields) and accept
// offset+limit. Handles initial fetch, refresh-tick depth restoration,
// Load more, and Load all.
//
// fetchPage(offset, limit) — Promise<{ items, total, ...meta }>.
//   The hook calls this with the current accumulated offset and the
//   configured pageSize. items and total are required; anything else
//   lands in `meta`, MERGED across pages within the same key (so a
//   field returned only on the first page — e.g. BrowsePage's
//   unowned_total — survives subsequent loadMore calls). meta wipes
//   on key change so a navigation to a new entity doesn't leak the
//   previous one's metadata. For pages whose API returns a different
//   key (e.g. api.getBooks → { books, total }), wrap inside the
//   callback to rename.
//
// deps — extra deps that trigger an initial reload (sort, filters, …).
//   The refresh tick + an internal refetch bump are added automatically.
//
// options:
//   key        — when this changes, treat as real navigation: wipe items
//                to [], reset loadedCount to 0, set loading=true, refetch
//                page 1. When unchanged, refresh-tick refetches silently
//                up to the prior loadedCount (so a Load-all'd view comes
//                back at its previous depth on alt-tab).
//   pageSize   — default 50.
//   stopWhen   — optional (collected) => boolean. After the natural
//                target depth is reached, the initial load keeps fetching
//                until this returns true (or items/total run out). Library
//                uses it for the density floor: "keep fetching until the
//                visible grid has at least one full row." Read via ref so
//                the closure tracks the latest state without forcing the
//                deps array to list every dependency.
//
// Returns:
//   items, total, meta                — accumulated array + counts
//   loadedCount                       — current depth (.length on
//                                       commit; the hook keeps a ref
//                                       internally for sync access)
//   hasMore                           — loadedCount < total
//   loading                           — initial / state-change load
//   loadingMore, loadingAll           — distinct button-state flags
//   error                             — initial-load failure (page-level)
//   actionError                       — Load more / Load all failure
//                                       (banner near the buttons)
//   loadMore(), loadAll(), refetch()  — stable identities, safe to wire
//                                       directly to spineEvent listeners
//   setItems, setTotal, setMeta,
//   setError, setActionError          — for optimistic mutations +
//                                       dismissible banners
//   setLoadedCount                    — synchronously adjust the internal
//                                       loaded-depth counter. Callers
//                                       that mutate items in place (e.g.
//                                       filter on delete) must decrement
//                                       so the next loadMore fetches at
//                                       the right offset and hasMore
//                                       stays accurate
//
// Notes:
//   * loadMore/loadAll share an internal pagingRef (same-tick lock)
//     AND an initialRef (blocks during initial fetch). Two refs because
//     the initial fetch is the load effect itself, not a paging op —
//     loadMore's finally must not clear initialRef.
//   * Errors propagate as the thrown value (an Error from api.js). Same
//     convention as useFreshFetch; render fixed-string banners on truthy.
export function usePaginatedFetch(fetchPage, deps = [], options = {}) {
  const { key, pageSize = 50, stopWhen } = options;

  const [items, setItems]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [meta, setMeta]         = useState({});
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll]   = useState(false);
  const [error, setError]       = useState(null);
  const [actionError, setActionError] = useState(null);
  const [bump, setBump]         = useState(0);

  const tick   = useRefreshTick();
  const guard  = useStaleGuard();
  const fetchPageRef = useLatest(fetchPage);
  const stopWhenRef  = useLatest(stopWhen);
  // totalRef so loadAll's loop can read the latest total without the
  // useCallback dep tax (a state-only read would force loadAll's
  // identity to change on every fetch, breaking spineEvent wiring).
  const totalRef = useLatest(total);

  // Synchronous depth — used by loadMore/loadAll for offsets AND by
  // the initial-load loop for refresh-tick depth restoration. Stays
  // in a ref so handlers can read it without re-render bookkeeping.
  const loadedRef = useRef(0);

  // Sync lock against same-tick duplicate Load more / Load all. State
  // setters batch; pagingRef closes that gap so two rapid clicks (or
  // Load more + Load all together) don't fire duplicate fetches at the
  // same offset.
  const pagingRef = useRef(false);
  // Sync flag for "initial / state-change load in flight." Blocks
  // loadMore/loadAll from firing duplicates when a palette / spineEvent
  // dispatches during the load (the buttons themselves are render-
  // gated on loading, but external triggers aren't).
  const initialRef = useRef(false);

  // Sentinel for first-run vs real key change, matching useFreshFetch.
  const FIRST_RUN = useRef({}).current;
  const prevKeyRef = useRef(FIRST_RUN);

  // Detect key change during render so the same commit ships the new
  // key with items wiped + loading=true. Without this, the same-paint
  // window between the deps changing and the effect firing leaves the
  // previous tab's books visible under the new tab's filter chips.
  if (key !== undefined && prevKeyRef.current !== key) {
    const isFirstRun = prevKeyRef.current === FIRST_RUN;
    prevKeyRef.current = key;
    if (!isFirstRun) {
      if (!loading) setLoading(true);
      if (items.length > 0) setItems([]);
      if (total !== 0) setTotal(0);
      // Meta wipes on key change too — without this, navigating to a
      // new list/browse-target would briefly render the previous one's
      // metadata (list name, unowned_total, etc.) until the first new
      // fetch resolves.
      setMeta({});
      loadedRef.current = 0;
    }
  }

  useEffect(() => {
    const epoch = guard.next();
    setError(null);
    setActionError(null);
    // Pagination state flags also reset — a refresh-tick that lands
    // mid-loadMore would otherwise strand loadingMore=true (the in-
    // flight call's finally is epoch-gated and won't clear it).
    setLoadingMore(false);
    setLoadingAll(false);
    pagingRef.current = false;
    initialRef.current = true;

    // Restore depth: on same-key refresh-tick the previous loadedRef
    // is preserved (above, we only zero it on key change), so the loop
    // fetches up to that depth. On real key change loadedRef is 0 and
    // the loop fetches just page 1.
    const prevDepth = loadedRef.current;

    (async () => {
      try {
        const collected = [];
        let serverTotal = 0;
        let lastMeta = {};
        const target = Math.max(pageSize, prevDepth);
        while (guard.isFresh(epoch)) {
          const { items: pageItems, total: pageTotal, ...rest } =
            await fetchPageRef.current(collected.length, pageSize);
          if (!guard.isFresh(epoch)) return;
          collected.push(...pageItems);
          serverTotal = pageTotal;
          lastMeta = rest;
          if (pageItems.length === 0) break;
          if (collected.length >= serverTotal) break;
          if (collected.length >= target) {
            // Past the natural target — only continue if a stopWhen
            // predicate asks for more. Without one, the target is the
            // floor and the loop exits here.
            if (!stopWhenRef.current || stopWhenRef.current(collected)) break;
          }
        }
        if (!guard.isFresh(epoch)) return;
        setItems(collected);
        setTotal(serverTotal);
        setMeta(m => ({ ...m, ...lastMeta }));
        loadedRef.current = collected.length;
      } catch (e) {
        if (guard.isFresh(epoch)) setError(e);
      } finally {
        initialRef.current = false;
        if (guard.isFresh(epoch)) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, bump, key, ...deps]);

  const loadMore = useCallback(async () => {
    if (pagingRef.current || initialRef.current) return;
    pagingRef.current = true;
    setLoadingMore(true);
    setActionError(null);
    const epoch = guard.current();
    try {
      const { items: pageItems, total: pageTotal, ...rest } =
        await fetchPageRef.current(loadedRef.current, pageSize);
      if (!guard.isFresh(epoch)) return;
      setItems(prev => [...prev, ...pageItems]);
      setTotal(pageTotal);
      setMeta(m => ({ ...m, ...rest }));
      loadedRef.current += pageItems.length;
    } catch (e) {
      if (guard.isFresh(epoch)) setActionError(e);
    } finally {
      // Clear pagingRef unconditionally — if the guard bumped, the new
      // load effect already reset loadingMore via setState; a stranded
      // ref would block all future paging on the new view.
      pagingRef.current = false;
      if (guard.isFresh(epoch)) setLoadingMore(false);
    }
  }, [guard, pageSize, fetchPageRef]);

  const loadAll = useCallback(async () => {
    if (pagingRef.current || initialRef.current) return;
    pagingRef.current = true;
    setLoadingAll(true);
    setActionError(null);
    const epoch = guard.current();
    try {
      let serverTotal = totalRef.current;
      while (guard.isFresh(epoch) && loadedRef.current < serverTotal) {
        const { items: pageItems, total: pageTotal, ...rest } =
          await fetchPageRef.current(loadedRef.current, pageSize);
        if (!guard.isFresh(epoch)) break;
        setItems(prev => [...prev, ...pageItems]);
        setTotal(pageTotal);
        setMeta(m => ({ ...m, ...rest }));
        loadedRef.current += pageItems.length;
        serverTotal = pageTotal;
        if (pageItems.length === 0) break;
      }
    } catch (e) {
      if (guard.isFresh(epoch)) setActionError(e);
    } finally {
      pagingRef.current = false;
      if (guard.isFresh(epoch)) setLoadingAll(false);
    }
  }, [guard, pageSize, fetchPageRef, totalRef]);

  const refetch = useCallback(() => setBump(b => b + 1), []);

  const setLoadedCount = useCallback((next) => {
    loadedRef.current = typeof next === 'function' ? next(loadedRef.current) : next;
  }, []);

  return {
    items, total, meta,
    setItems, setTotal, setMeta,
    loading, loadingMore, loadingAll,
    hasMore: loadedRef.current < total,
    loadedCount: loadedRef.current,
    setLoadedCount,
    error, actionError,
    setError, setActionError,
    loadMore, loadAll, refetch,
  };
}
