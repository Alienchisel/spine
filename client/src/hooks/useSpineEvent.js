import { useEffect } from 'react';
import { useLatest } from './useLatest.js';

// Names the window.addEventListener('spine:*') idiom Spine uses for
// cross-component coordination (book mutations, library paging state,
// etc.). Handler is read lazily so inline closures over current state
// stay fresh without re-subscribing on every render. Caller reads
// `event.detail` if the event carries a payload.
//
// Existing event vocabulary:
//   spine:book-mutated          { id }   — book changed, refetch
//   spine:book-deleted          { id }   — book gone, prune
//   spine:reads-mutated         { id }   — a read-history row was added,
//                                          updated, or removed (date_started /
//                                          date_finished / did_not_finish /
//                                          read_count). Distinct from
//                                          book-mutated so Stats can drop its
//                                          cache without surfaces that don't
//                                          care (e.g. Audit) needing to listen.
//   spine:library-paging        { hasMore, loadingMore, loadingAll, loaded, total }
//   spine:library-paging-request         — ask Library to re-publish paging state
//   spine:library-load-more              — invoke Library's load-more
//   spine:library-load-all               — invoke Library's load-all
export function useSpineEvent(eventName, handler) {
  const handlerRef = useLatest(handler);
  useEffect(() => {
    const listener = (e) => handlerRef.current(e);
    window.addEventListener(eventName, listener);
    return () => window.removeEventListener(eventName, listener);
  }, [eventName]); // handlerRef is stable; read lazily inside the listener
}

// Cross-tab mirror. Data-mutation events also post to a BroadcastChannel
// so other open tabs invalidate their query caches (via the queryClient
// bridge, which listens for the replayed window events) — without this,
// staleTime: Infinity means a second tab never learns about an edit made
// in the first. Only mutation events cross the tab boundary: the
// library-paging / open-command-palette family is tab-local UI intent
// (Load more in one tab must not scroll-extend another).
//
// No echo guard needed — BroadcastChannel never delivers a message back
// to the tab that posted it, and replaying via window.dispatchEvent
// doesn't re-enter dispatchSpineEvent.
const CROSS_TAB_EVENTS = new Set([
  'spine:book-mutated',
  'spine:book-deleted',
  'spine:reads-mutated',
  'spine:author-deleted',
]);
const channel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('spine-events')
  : null;
if (channel) {
  channel.onmessage = (msg) => {
    const { name, detail } = msg.data || {};
    if (!CROSS_TAB_EVENTS.has(name)) return;
    window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
  };
  // Dev-only: close the channel when Vite hot-replaces this module,
  // otherwise each reload leaves a zombie listener replaying every
  // event twice.
  if (import.meta.hot) import.meta.hot.dispose(() => channel.close());
}

// Companion dispatcher. Wraps the `new CustomEvent(...)` boilerplate;
// pass a detail object when listeners read e.detail.
export function dispatchSpineEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, detail !== undefined ? { detail } : undefined));
  if (channel && CROSS_TAB_EVENTS.has(name)) {
    channel.postMessage({ name, detail });
  }
}
