// TanStack Query client configured for Spine's single-user shape.
//
// Spine has exactly one writer (you), so the standard React Query
// defaults — refetch on focus, staleTime: 0, aggressive revalidation
// — are wrong. You're never going to see data changed behind your
// back. Every state change goes through your own code, and that
// code can invalidate the cache surgically.
//
// The recipe:
//
//   * staleTime: Infinity — data is never considered stale by time
//     alone. The only thing that invalidates is an explicit
//     queryClient.invalidateQueries() call from a mutation or the
//     spine-event bridge below.
//
//   * refetchOnWindowFocus: false — no automatic refetch when you
//     tab back in. This is the whole reason for the port. Cross-tab
//     freshness is instead handled by the mutation-driven event
//     bridge: dispatchSpineEvent mirrors mutation events over a
//     BroadcastChannel, other tabs replay them as window events,
//     and the listeners below invalidate.
//
//   * refetchOnMount left at the default (true): with staleTime
//     Infinity, non-invalidated queries stay fresh on remount and
//     don't refetch. But invalidateQueries flips isInvalidated,
//     which makes isStaleByTime return true even under staleTime
//     Infinity — so an invalidated query DOES refetch on next
//     mount. Setting refetchOnMount: false here would suppress
//     that too (see query-core/src/queryObserver.ts shouldFetchOn:
//     value === false short-circuits before isStale is consulted),
//     stranding stale cover_path / titles / etc. on unmounted-then-
//     revisited list pages after any mutation. 2026-07-10 Wheels-
//     of-Commerce cover incident.
//
//   * refetchOnReconnect: false — network drop → recover shouldn't
//     spontaneously refetch either.
//
//   * gcTime: 30 minutes — cached queries survive component unmount
//     for half an hour. Long enough to cover most tab-hop-and-return
//     patterns without eating memory forever. Default is 5 minutes.
//
//   * retry: 1 — on failure, retry once. The default of 3 with
//     exponential backoff makes a real failure take ~30 seconds to
//     surface, which feels broken on a single-user local app.
//
// The bridge:
//
// Existing Spine pages fire two window events on any book mutation:
// spine:book-mutated (id) and spine:book-deleted (id). This module
// listens for them ONCE at import time and invalidates any query
// key that starts with ['book', id] or that references the mutated
// book. So even code paths that haven't been migrated to useQuery
// still trigger correct cache invalidation for those that have.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

// Bridge from the existing spine-event system into TanStack Query
// cache invalidation. When a book is mutated anywhere in the app,
// invalidate every list-shaped query — book edits can move a book
// in or out of Loved / Readlist / Notes / a tag / an author's
// bibliography / the Audit gap buckets / the Diary if the edit
// adds a reading_log row / the Stats aggregates. The blast radius
// is broad enough that enumerating exact keys is worse than just
// invalidating them all: invalidateQueries only refetches queries
// that currently have observers (mounted pages), so unmounted keys
// just get marked stale and re-fetch on next visit.
//
// The per-book ['book', id, ...] queries are invalidated by exact
// key so an edit on book #123 doesn't invalidate all other books'
// caches.
//
// Also fires on spine:reads-mutated (a POST/PATCH/DELETE against a
// book's reads sub-resource) since reads flow into date_finished-
// dependent surfaces (Stats, Diary, Author, Today).
if (typeof window !== 'undefined') {
  // Broad invalidation for every list-shaped surface. Covers
  // Loved / Library / Author / Readlist / Notes / Diary / Audit /
  // Stats / Tags / Series index / Authors index / etc. The
  // predicate filters to the coarse list keys we know about; add
  // to the set as new query keys join the codebase.
  const LIST_KEYS = new Set([
    'loved', 'authors', 'series', 'tags', 'lists', 'readlist',
    'notes', 'diary', 'audit', 'stats', 'shelfTree', 'author',
    'settings', 'today', 'collage', 'collage-facets',
    // ShelfView surfaces — tree counts, unshelfed list, and the
    // current location's book grid all drift on shelf/location edits
    'unshelfed', 'shelfLocation',
    // Library-specific keys (paginated fetch + supporting queries)
    'library', 'library-counts', 'library-facets', 'library-cohort',
    // Browse / ListDetail — same shape
    'browse', 'browse-facets', 'browse-cohort',
    'list', 'list-cohort',
  ]);
  function invalidateListKeys() {
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && LIST_KEYS.has(q.queryKey[0]),
    });
  }
  function invalidateForBook(id) {
    // Per-book queries (['book', id], ['book', id, 'log'],
    // ['book', id, 'reads']) — narrow invalidation so other books'
    // caches are untouched.
    queryClient.invalidateQueries({ queryKey: ['book', id] });
    invalidateListKeys();
  }
  // Safety net: api.js fires this on EVERY successful non-GET request,
  // so mutation surfaces without a precise spine:book-mutated dispatch
  // still invalidate the list-shaped caches. Surfaces that do dispatch
  // precisely get a redundant second blast — harmless, invalidation is
  // idempotent within a tick and only mounted observers refetch.
  window.addEventListener('spine:data-mutated', () => invalidateListKeys());
  window.addEventListener('spine:book-mutated', (e) => {
    const id = Number(e?.detail?.id);
    if (Number.isFinite(id)) invalidateForBook(id);
  });
  window.addEventListener('spine:book-deleted', (e) => {
    const id = Number(e?.detail?.id);
    if (Number.isFinite(id)) invalidateForBook(id);
  });
  window.addEventListener('spine:reads-mutated', (e) => {
    const id = Number(e?.detail?.id);
    if (Number.isFinite(id)) invalidateForBook(id);
  });

  // ── Cross-DEVICE staleness check ──────────────────────────────────
  // The event bridge (and its BroadcastChannel mirror) only reaches
  // tabs of THIS browser. Spine is also used from the phone over
  // Tailscale — a write there never fires an event here, and with
  // staleTime: Infinity this browser would show stale data forever.
  // So on tab focus, ask the server's data-version beacon (bumped by
  // every successful mutation, see lib/dataVersion.js) whether
  // anything was written since we last looked, and invalidate
  // everything only if the answer is yes. The common case — nothing
  // changed — costs one tiny GET and zero refetches, preserving the
  // no-refetch-on-alt-tab behaviour this config exists for.
  let lastSeenVersion = null;
  let versionCheckInFlight = false;

  async function fetchDataVersion() {
    const res = await fetch('/api/version');
    if (!res.ok) throw new Error(`version check: ${res.status}`);
    return (await res.json()).version;
  }

  async function checkDataVersion() {
    // focus and visibilitychange often fire back-to-back; one check
    // per burst is plenty.
    if (versionCheckInFlight) return;
    versionCheckInFlight = true;
    try {
      const version = await fetchDataVersion();
      // First sighting just records the baseline — invalidating on an
      // unknown version would refetch everything on every page load.
      if (lastSeenVersion !== null && version !== lastSeenVersion) {
        queryClient.invalidateQueries();
      }
      lastSeenVersion = version;
    } catch {
      // Network hiccup — keep the old baseline; the next focus retries.
    } finally {
      versionCheckInFlight = false;
    }
  }

  // Local mutations bump the server version too, but this browser
  // already invalidated precisely via the event bridge — so quietly
  // re-baseline after each mutation burst, otherwise the next focus
  // would see a "changed" version and redundantly invalidate all.
  // Debounced: a multi-step action (finish book + log read) fires
  // several events but needs only one re-baseline. The window between
  // a remote write and this sync adopting its version unseen is
  // sub-second — accepted.
  let versionSyncTimer = null;
  function rebaselineVersionSoon() {
    clearTimeout(versionSyncTimer);
    versionSyncTimer = setTimeout(async () => {
      try { lastSeenVersion = await fetchDataVersion(); } catch {}
    }, 500);
  }
  // spine:data-mutated covers every api.js write, including surfaces
  // that fire no precise event — without it those writes would look
  // like remote changes on the next focus and trigger a full
  // invalidation.
  for (const evt of ['spine:book-mutated', 'spine:book-deleted', 'spine:reads-mutated', 'spine:data-mutated']) {
    window.addEventListener(evt, rebaselineVersionSoon);
  }

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDataVersion();
  });
  window.addEventListener('focus', () => checkDataVersion());
  // Prime the baseline so the FIRST focus check has something to
  // compare against instead of silently re-baselining.
  checkDataVersion();
}
