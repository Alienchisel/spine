// "Load all" for a paginated useInfiniteQuery (Library, Browse, ListDetail).
import { useCallback, useEffect, useRef, useState } from 'react';

// Fetch every remaining page. Loops on the result each fetchNextPage()
// resolves with — never on `query.hasNextPage`. The `query` a callback
// closes over is that render's result object, frozen for the life of the
// callback, so its hasNextPage never flips to false; and once the last
// page is in, fetchNextPage() resolves immediately without fetching. The
// old `while (query.hasNextPage) await query.fetchNextPage()` therefore
// became a microtask spin that froze the tab for good.
//
// Also stops when a fetch makes no progress (dataUpdatedAt unchanged), so
// no future edge case can turn this back into a spin, and when isStale()
// says the caller has moved on.
export async function fetchAllPages(query, isStale = () => false) {
  let result = query;
  while (result.hasNextPage && !isStale()) {
    const before = result.dataUpdatedAt;
    result = await result.fetchNextPage();
    if (result.isError) throw result.error;
    if (result.dataUpdatedAt === before) break;
  }
}

// Hook wrapper: owns the loadingAll flag and cancels the loop when the
// query key changes (tab / sort / filter / search switch) or the page
// unmounts. fetchNextPage always targets the hook's CURRENT query, so
// without this a loop started on one tab would go on to load every page
// of whatever the user switched to. setActionError is the page's error
// setter; errors from an abandoned loop are dropped.
export function useLoadAll(query, queryKey, setActionError) {
  const [loadingAll, setLoadingAll] = useState(false);
  const keyString = JSON.stringify(queryKey);
  const liveKeyRef = useRef(keyString);
  useEffect(() => {
    liveKeyRef.current = keyString;
    return () => { liveKeyRef.current = null; };
  }, [keyString]);

  const loadAll = useCallback(async () => {
    if (loadingAll || query.isFetchingNextPage) return;
    const startKey = liveKeyRef.current;
    const isStale = () => liveKeyRef.current !== startKey;
    setLoadingAll(true);
    setActionError(null);
    try {
      await fetchAllPages(query, isStale);
    } catch (e) {
      if (!isStale()) setActionError(e);
    } finally {
      setLoadingAll(false);
    }
  }, [query, loadingAll, setActionError]);

  return { loadingAll, loadAll };
}
