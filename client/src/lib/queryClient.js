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
//     bridge (which fires spine:book-mutated events; see below).
//
//   * refetchOnMount: false — a page you already visited keeps its
//     cached data on re-navigation; no fetch fires. Same story.
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
      refetchOnMount: false,
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
  function invalidateForBook(id) {
    // Per-book queries (['book', id], ['book', id, 'log'],
    // ['book', id, 'reads']) — narrow invalidation so other books'
    // caches are untouched.
    queryClient.invalidateQueries({ queryKey: ['book', id] });
    // Broad invalidation for every list-shaped surface. Covers
    // Loved / Library / Author / Readlist / Notes / Diary / Audit /
    // Stats / Tags / Series index / Authors index / etc. The
    // predicate filters to the coarse list keys we know about; add
    // to the set as new query keys join the codebase.
    const LIST_KEYS = new Set([
      'loved', 'authors', 'series', 'tags', 'lists', 'readlist',
      'notes', 'diary', 'audit', 'stats', 'shelfTree', 'author',
      'settings',
      // Library-specific keys (paginated fetch + supporting queries)
      'library', 'library-counts', 'library-facets', 'library-cohort',
      // Browse / ListDetail — same shape
      'browse', 'browse-facets', 'browse-cohort',
      'list', 'list-cohort',
    ]);
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && LIST_KEYS.has(q.queryKey[0]),
    });
  }
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
}
