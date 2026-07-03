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
// invalidate every query that carries that book's id in its key.
// Also invalidate the coarser ['books'] / ['loved'] / ['authors']
// list keys since a book edit can move it in or out of a list
// cohort. Runs once at module import — no cleanup needed because
// the queryClient lives for the app's whole lifetime.
if (typeof window !== 'undefined') {
  function invalidateForBook(id) {
    // Any per-book query with this id in the key.
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey)
        && q.queryKey.some(k => (
          k === id
          || (typeof k === 'object' && k !== null && Number(k.id) === id)
        )),
    });
    // Coarse list keys — a mutation might change list membership.
    queryClient.invalidateQueries({ queryKey: ['books']   });
    queryClient.invalidateQueries({ queryKey: ['loved']   });
    queryClient.invalidateQueries({ queryKey: ['authors'] });
    queryClient.invalidateQueries({ queryKey: ['series']  });
  }
  window.addEventListener('spine:book-mutated', (e) => {
    const id = Number(e?.detail?.id);
    if (Number.isFinite(id)) invalidateForBook(id);
  });
  window.addEventListener('spine:book-deleted', (e) => {
    const id = Number(e?.detail?.id);
    if (Number.isFinite(id)) invalidateForBook(id);
  });
}
