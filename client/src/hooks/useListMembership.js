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
  // Create-list state is tracked separately from toggle state so the
  // two can fail / spin independently — a duplicate-name reject on
  // create shouldn't clear a stale failed-toggle banner, and vice versa.
  const [creating, setCreating]   = useState(false);
  const [createError, setCreateError] = useState(null);
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

  // Create a new list and immediately add the current book to it.
  // Compresses the "navigate away to /lists, create, navigate back,
  // re-open picker, check it" detour into one in-context action.
  // Optimistically appends the new list to the lists array and marks
  // it as a member so the picker UI updates without a refetch.
  // Returns the created list on success, throws on failure (caller can
  // inspect createError state).
  async function createListAndAdd(name) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      setCreateError('List name is required');
      throw new Error('List name is required');
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.createList(trimmed);
      // Server may return additional fields (book_count, etc.); fall
      // through with whatever shape it sends so the picker UI matches
      // what subsequent refetches will produce.
      await api.addToList(created.id, bookId);
      // Insert in alphabetical position rather than appending — matches
      // the server's ORDER BY name ASC, so the just-created list sits
      // where the user expects to find it (a subsequent open / refetch
      // would put it there anyway, and the check-mark already provides
      // the "just created" feedback signal).
      setLists(curr => [...curr, created].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      setMemberIds(s => new Set([...s, created.id]));
      onToggled?.();
      return created;
    } catch (err) {
      // Most likely cause: duplicate name (server returns 4xx). The
      // generic message keeps the UI honest without parsing the
      // server's error shape.
      setCreateError('Could not create list. Name may already be taken.');
      onError?.();
      throw err;
    } finally {
      setCreating(false);
    }
  }

  function clearError() { setError(null); }
  function clearCreateError() { setCreateError(null); }

  return {
    lists, memberIds, busyIds, loading, error,
    creating, createError,
    load, toggle, createListAndAdd,
    clearError, clearCreateError,
  };
}
