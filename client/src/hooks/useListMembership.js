import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLatest } from './useLatest.js';
import { useStaleGuard } from './useStaleGuard.js';
import { useSpineEvent } from './useSpineEvent.js';

// Owns the "which lists does this book belong to" state shared by
// ListPicker and MoreMenu. Both surfaces load the same lists +
// memberships pair, toggle membership the same way, and need the same
// spine:book-mutated sync so palette-driven adds keep their check-marks
// fresh. Extracted as a hook so the two consumers can't drift.
//
// onToggled fires after a successful add/remove — MoreMenu wires this to
// dispatchSpineEvent('spine:book-mutated') so other surfaces refetch.
// ListPicker omits it: its own dispatch would loop back into this hook's
// listener and trigger a redundant refetch on the same component.
// onError mirrors onToggled but for failure — lets a consumer (MoreMenu)
// surface the failure outside the picker dropdown, since the in-dropdown
// error message disappears with the menu and is easy to miss. ListPicker
// stays open and shows the error inline, so it doesn't need the callback.
export function useListMembership(bookId, { onToggled, onError } = {}) {
  const [lists, setLists]         = useState([]);
  const [memberIds, setMemberIds] = useState(new Set());
  const [loading, setLoading]     = useState(false);
  const [busyIds, setBusyIds]     = useState(new Set());
  const [error, setError]         = useState(null);
  const loadGuard = useStaleGuard();
  // `busyIds` (React state) drives the disabled UI but doesn't commit
  // until the next render — so two same-tick toggle clicks both see the
  // pre-commit value and fire duplicate add/remove PUTs. The ref mutates
  // synchronously so the second call sees the first's marker.
  const busyIdsRef = useRef(new Set());
  const currentBookIdRef = useLatest(bookId);

  // Reset memberships when navigating between books so the old book's
  // check-marks don't briefly seed the picker for the new one.
  useEffect(() => {
    setMemberIds(new Set());
  }, [bookId]);

  // Stay in sync with palette-driven (or any external) mutations on
  // this book. Always listens so the cache is current on the next open
  // too, not just while a picker is open.
  useSpineEvent('spine:book-mutated', (e) => {
    const evtBookId = Number(e.detail?.id);
    if (evtBookId !== Number(bookId)) return;
    api.getBookLists(bookId)
      .then(ids => {
        // Drop the response if the user has navigated to a different
        // book in the meantime — without this, an in-flight refetch
        // started while bookId was still X could land setMemberIds on
        // the component now showing Y.
        if (Number(currentBookIdRef.current) !== evtBookId) return;
        setMemberIds(new Set(ids));
      })
      .catch(() => {});
  });

  async function load() {
    setLoading(true);
    setError(null);
    const epoch = loadGuard.next();
    // Promise.allSettled splits the two failure modes: getLists is
    // load-bearing (no lists = nothing to pick from), getBookLists is
    // supplementary (just the check-mark state). With Promise.all, a
    // failed memberships fetch would discard successfully-loaded lists
    // and surface as "Failed to load lists" — misleading.
    const [listsR, idsR] = await Promise.allSettled([
      api.getLists(),
      api.getBookLists(bookId),
    ]);
    if (!loadGuard.isFresh(epoch)) return;
    if (listsR.status === 'fulfilled') setLists(listsR.value);
    else { setLists([]); setError('Failed to load lists'); }
    if (idsR.status === 'fulfilled') setMemberIds(new Set(idsR.value));
    else setMemberIds(new Set());
    setLoading(false);
  }

  async function toggle(listId) {
    if (busyIdsRef.current.has(listId)) return;
    busyIdsRef.current.add(listId);
    setBusyIds(s => new Set([...s, listId]));
    setError(null);
    try {
      if (memberIds.has(listId)) {
        await api.removeFromList(listId, bookId);
        setMemberIds(s => { const n = new Set(s); n.delete(listId); return n; });
      } else {
        await api.addToList(listId, bookId);
        setMemberIds(s => new Set([...s, listId]));
      }
      onToggled?.();
    } catch {
      setError('Failed to update list');
      onError?.();
    } finally {
      busyIdsRef.current.delete(listId);
      setBusyIds(s => { const n = new Set(s); n.delete(listId); return n; });
    }
  }

  function clearError() { setError(null); }

  return { lists, memberIds, busyIds, loading, error, load, toggle, clearError };
}
