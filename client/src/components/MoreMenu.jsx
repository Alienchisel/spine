import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { realTagNames, labelForPath } from '../utils.js';
import { useConfirm } from './ConfirmModal.jsx';
import StarRating from './StarRating.jsx';
import { useClickOutside } from '../hooks/useClickOutside.js';
import { useEscapeKey } from '../hooks/useEscapeKey.js';
import { useListMembership } from '../hooks/useListMembership.js';
import NewListInput from './NewListInput.jsx';
import { dispatchSpineEvent } from '../hooks/useSpineEvent.js';

// Letterboxd-style 'more actions' button for BookCard's hover-tray
// (the third slot, alongside readlist and loved). Opens a portal-
// rendered menu with status mutations + Add-to-lists / Edit / Delete.
//
// Architecture mirrors ListPicker's pattern (portal popover, fixed
// positioning relative to the trigger, mousedown/scroll/Escape close
// handlers). The 'Add to lists' branch opens a sub-state within the
// same menu rather than nesting a separate ListPicker popover — keeps
// the visual model simple and the keyboard contract one-level deep.
// The lists/memberships/toggle logic is shared with ListPicker via
// useListMembership.
//
// Status mutations (Mark as finished / reading / unread) hit
// api.updateBook (PUT — status isn't in the PATCH whitelist) and
// rely on updateBook's finish-transition magic for the reads-row
// auto-insert and read_count auto-increment. Mirrors BookDetail's
// handleFinish payload shape: today-default on date_finished
// (skipped for previously_owned books, since those are typically
// historical reads with unknown dates), today-default on date_started
// when moving into 'reading'.
//
// Mutations dispatch two events so other surfaces stay in sync:
//   - spine:book-mutated  — fired after list add/remove, rating,
//     status, and archive/restore mutations. BookDetail / ListPicker /
//     Library all listen and refetch the affected book (or its
//     sub-data).
//   - spine:book-deleted  — fired after successful api.deleteBook.
//     Library listens and removes the book from its visible list
//     without a refetch round-trip.

function DotsIcon({ className }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className}>
      <circle cx="3"  cy="8" r="1.5" />
      <circle cx="8"  cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}

export default function MoreMenu({ book, dropUp = false, iconClassName = 'w-5 h-5', buttonClassName = '', onOpenProgress, returnState }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [subPrompt, setSubPrompt] = useState(null);  // null | 'add-to-lists' | 'shelf-location'
  // Optimistic local rating: lets the star widget react instantly to
  // a click even though the PUT round-trip + Library refetch takes
  // ~100-300ms before book.rating reflects the new value. Reset to
  // book.rating whenever the prop changes (e.g. after the refetch,
  // or if the card swapped to a different book).
  const [localRating, setLocalRating] = useState(book.rating ?? null);
  useEffect(() => { setLocalRating(book.rating ?? null); }, [book.rating, book.id]);
  // Inline error for any action that may fail after the menu has
  // moved on — rating, list toggle, status change, archive, delete.
  // The menu has no other render slot for feedback, so the button
  // icon swaps to a '!' with the message on `title=`. Auto-clears
  // after a few seconds so the badge doesn't sit forever on a card
  // the user has stopped interacting with.
  const [actionError, setActionError] = useState(null);
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(t);
  }, [actionError]);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const confirm = useConfirm();
  const { lists, memberIds, busyIds, loading: loadingLists, error, creating, createError, load, toggle, createListAndAdd, clearError, clearCreateError } = useListMembership(book.id, {
    onToggled: () => {
      // Successful toggle clears any stale badge — list toggles keep
      // the picker open, so the auto-clear on menu reopen doesn't fire.
      setActionError(null);
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
    },
    // The picker's own 'Failed to update list' banner disappears with
    // the menu — surface a persistent warn-icon on the trigger button
    // so the user notices the failure after closing.
    onError:   () => setActionError('Failed to update list. Try again.'),
  });

  // Location sub-prompt: loads getShelfTree on first open (cached across
  // re-opens), flattens to a searchable list of every placement target
  // — buildings, rooms, units, AND shelves — and patches the book on
  // selection. Coarser-than-shelf placement is offered because the
  // schema supports it natively ("I know it's in Living Room but
  // haven't picked a shelf") and AddBookHere on ShelfView already
  // patches at whichever level the user is browsing. Caches the tree
  // on the component so a second open doesn't re-fetch.
  const [shelfTree, setShelfTree]       = useState(null);
  const [shelfLoading, setShelfLoading] = useState(false);
  const [shelfError, setShelfError]     = useState(null);
  const [shelfQuery, setShelfQuery]     = useState('');
  const [placingKey, setPlacingKey]     = useState(null);
  // Expanded parent keys in browse mode. Cleared on close so re-opens
  // start collapsed — the picker is meant to fit a single screen, not
  // remember the user's last drill-down.
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const shelfSearchRef = useRef(null);
  // Show the Location… entry only when placement makes sense — physical
  // owned books. Ebooks/audiobooks have no shelf, and unowned wishlist
  // entries aren't physically present. `book.owned !== 0` rather than
  // `!!book.owned` because some surfaces (notably ShelfView's
  // /shelf/unshelfed and the per-shelf endpoints) don't include the
  // owned column in their projection — those surfaces already filter
  // to owned books server-side, so treating undefined as ownable
  // surfaces the action on those cards too.
  const canShelve = book.format === 'physical' && book.owned !== 0;

  // Depth-first flatten of the tree into placement rows. Each row
  // carries:
  //   - patch:       the single-id PATCH shape (same as AddBookHere)
  //   - label:       short local name ("Living Room", "Top shelf")
  //   - crumb:       full breadcrumb for tooltip + search-mode display
  //   - search:      lowercase crumb for substring matching
  //   - parentKey:   the row above this one in the hierarchy, used for
  //                  browse-mode expand/collapse. null on roots.
  //   - depth:       indent step in browse mode. Renders relative to
  //                  whichever rows are actually shown — when the
  //                  library has a single building, the building's row
  //                  is suppressed and rooms become roots (depth 0).
  //
  // Single-building trimming: in a one-building library the "Home · "
  // prefix on every crumb is dead weight (it's the same on every row
  // and there's nothing to disambiguate). Drop the row, drop the
  // prefix, and let rooms become the top-level entries.
  const flatLocations = useMemo(() => {
    if (!shelfTree) return [];
    const singleBuilding = shelfTree.length === 1;
    const out = [];
    for (const b of shelfTree) {
      if (!singleBuilding) {
        out.push({
          key: `b-${b.id}`, level: 'building', parentKey: null, depth: 0,
          patch: { building_id: b.id },
          label: b.name,
          crumb: b.name,
          search: b.name.toLowerCase(),
        });
      }
      const prefix = singleBuilding ? '' : `${b.name} · `;
      const bKey   = singleBuilding ? null : `b-${b.id}`;
      const rDepth = singleBuilding ? 0 : 1;
      for (const r of b.rooms || []) {
        out.push({
          key: `r-${r.id}`, level: 'room', parentKey: bKey, depth: rDepth,
          patch: { room_id: r.id },
          label: r.name,
          crumb: `${prefix}${r.name}`,
          search: `${prefix}${r.name}`.toLowerCase(),
        });
        for (const u of r.units || []) {
          out.push({
            key: `u-${u.id}`, level: 'unit', parentKey: `r-${r.id}`, depth: rDepth + 1,
            patch: { unit_id: u.id },
            label: u.name,
            crumb: `${prefix}${r.name} · ${u.name}`,
            search: `${prefix}${r.name} ${u.name}`.toLowerCase(),
          });
          for (const s of u.shelves || []) {
            out.push({
              key: `s-${s.id}`, level: 'shelf', parentKey: `u-${u.id}`, depth: rDepth + 2,
              patch: { shelf_id: s.id },
              label: s.label,
              crumb: `${prefix}${r.name} · ${u.name} · ${s.label}`,
              search: `${prefix}${r.name} ${u.name} ${s.label}`.toLowerCase(),
            });
          }
        }
      }
    }
    return out;
  }, [shelfTree]);

  // Which rows have children — drives the chevron rendering in browse
  // mode. Shelves are always leaves, so they never appear here.
  const parentKeysWithChildren = useMemo(() => {
    const set = new Set();
    for (const l of flatLocations) {
      if (l.parentKey) set.add(l.parentKey);
    }
    return set;
  }, [flatLocations]);

  // Browse mode (no query): show roots + children of explicitly-
  // expanded parents. Search mode (query non-empty): bypass the
  // expand state and show every row that matches the substring so
  // the user can jump straight to a specific shelf without drilling.
  const visibleLocations = useMemo(() => {
    const q = shelfQuery.trim().toLowerCase();
    if (q) return flatLocations.filter(l => l.search.includes(q));
    return flatLocations.filter(l => l.parentKey === null || expandedKeys.has(l.parentKey));
  }, [flatLocations, shelfQuery, expandedKeys]);

  function toggleExpand(key) {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Resolve the book's current placement to a breadcrumb. Picks the
  // most-specific populated id and looks up the corresponding flat row.
  const currentLocationCrumb = useMemo(() => {
    if (!shelfTree) return null;
    if (book.shelf_id) {
      const f = flatLocations.find(l => l.level === 'shelf' && l.patch.shelf_id === book.shelf_id);
      if (f) return f.crumb;
    }
    if (book.unit_id) {
      const f = flatLocations.find(l => l.level === 'unit' && l.patch.unit_id === book.unit_id);
      if (f) return f.crumb;
    }
    if (book.room_id) {
      const f = flatLocations.find(l => l.level === 'room' && l.patch.room_id === book.room_id);
      if (f) return f.crumb;
    }
    if (book.building_id) {
      const f = flatLocations.find(l => l.level === 'building' && l.patch.building_id === book.building_id);
      if (f) return f.crumb;
      // Single-building libraries suppress the building row in
      // flatLocations, so the find above misses. Fall back to a direct
      // tree lookup so a book placed at building level still shows its
      // current location in the picker header.
      const b = shelfTree.find(x => x.id === book.building_id);
      if (b) return b.name;
    }
    return null;
  }, [shelfTree, flatLocations, book.shelf_id, book.unit_id, book.room_id, book.building_id]);

  useClickOutside([buttonRef, dropdownRef], () => setOpen(false), open);
  // Inside a sub-prompt, Escape returns to the root menu; from the root
  // menu, Escape closes the whole popover and returns focus to the
  // trigger.
  useEscapeKey(() => {
    if (subPrompt) setSubPrompt(null);
    else { setOpen(false); buttonRef.current?.focus(); }
  }, open);

  // Scroll-close: portaled popover misaligns from its trigger when the
  // page scrolls. Inner-overflow scroll is excluded so scrolling the
  // sub-prompt list doesn't close the menu around it. Mirrored in ListPicker.
  useEffect(() => {
    if (!open) return;
    function onScroll(e) {
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open]);

  function handleOpen(e) {
    e.preventDefault();
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 224;
    const idealLeft = rect.right - menuWidth;
    const left = Math.min(Math.max(idealLeft, 8), window.innerWidth - menuWidth - 8);
    // Anchor-relative max-height — see the equivalent computation in
    // ListPicker for the rationale: 80vh is viewport-relative, not
    // anchor-relative, so the natural bottom of the dropdown could land
    // past the viewport edge and the sticky-footer NewListInput would
    // be pinned off-screen.
    const VIEWPORT_PADDING = 12;
    const availableBelow = window.innerHeight - rect.bottom - 4 - VIEWPORT_PADDING;
    const availableAbove = rect.top - 4 - VIEWPORT_PADDING;
    const maxHeight = Math.max(160, dropUp ? availableAbove : availableBelow);
    setPos({
      top:    dropUp ? undefined : rect.bottom + 4,
      bottom: dropUp ? window.innerHeight - rect.top + 4 : undefined,
      left,
      maxHeight,
    });
    setOpen(true);
    setSubPrompt(null);
    // Opening the menu acknowledges the prior error — drop the badge
    // so it doesn't sit through subsequent interactions.
    setActionError(null);
    clearError();
  }

  async function openListsSubPrompt(e) {
    e.preventDefault();
    e.stopPropagation();
    setSubPrompt('add-to-lists');
    await load();
  }

  async function toggleList(e, listId) {
    e.preventDefault();
    e.stopPropagation();
    toggle(listId);
  }

  async function openShelfSubPrompt(e) {
    e.preventDefault();
    e.stopPropagation();
    setSubPrompt('shelf-location');
    setShelfQuery('');
    setExpandedKeys(new Set());
    // Defer focus past the render that mounts the sub-prompt input.
    setTimeout(() => shelfSearchRef.current?.focus(), 0);
    // Tree cache — load once, reuse across re-opens of the sub-prompt.
    if (shelfTree) return;
    setShelfLoading(true);
    setShelfError(null);
    try {
      const tree = await api.getShelfTree();
      setShelfTree(tree);
    } catch {
      setShelfError('Failed to load shelves.');
    } finally {
      setShelfLoading(false);
    }
  }

  // PATCH the book to a placement at any level. The location row carries
  // a single-id patch ({ building_id } or { room_id } or { unit_id } or
  // { shelf_id }); the server's normalizeBookLocation derives the parent
  // ids and clears any non-chosen children, so the patch stays minimal.
  // Card refetches via spine:book-mutated; menu closes after.
  async function placeAt(location) {
    if (placingKey != null) return;
    setPlacingKey(location.key);
    try {
      await api.patchBook(book.id, location.patch);
      setActionError(null);
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
      setOpen(false);
    } catch {
      setActionError('Failed to set location. Try again.');
    } finally {
      setPlacingKey(null);
    }
  }

  // Explicit unshelve. Clears all four placement ids so a previously
  // coarser placement (book on a room or unit, no specific shelf)
  // doesn't survive a "remove" intended to fully unshelve.
  async function removeFromShelf() {
    if (placingKey != null) return;
    setPlacingKey('remove');
    try {
      await api.patchBook(book.id, { shelf_id: null, unit_id: null, room_id: null, building_id: null });
      setActionError(null);
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
      setOpen(false);
    } catch {
      setActionError('Failed to remove from shelf. Try again.');
    } finally {
      setPlacingKey(null);
    }
  }

  // Apply a rating change via a full PUT. Same payload shape as
  // changeStatus — joined arrays flattened to name lists, virtual
  // tags filtered. Optimistic local update so the stars react
  // instantly; rolled back on error.
  async function handleRate(rating) {
    // Roll back to the last visible optimistic value, not the parent's
    // possibly-stale book.rating. After a rapid 3→4→5 sequence where
    // 4's save lands before the parent refetch propagates, book.rating
    // is still 3 but the user has seen 4 — a failed 5 should restore
    // 4, not 3.
    const prior = localRating;
    setLocalRating(rating);
    try {
      await api.updateBook(book.id, {
        ...book,
        authors:     book.authors?.map(a => a.name) ?? [],
        narrators:   book.narrators?.map(n => n.name) ?? [],
        translators: book.translators?.map(t => t.name) ?? [],
        tags:        realTagNames(book.tags),
        rating,
      });
      // Successful retry should clear any stale badge from a previous
      // failure — rating actions keep the menu open, so the auto-clear
      // on reopen doesn't fire.
      setActionError(null);
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
    } catch {
      setLocalRating(prior);
      setActionError('Failed to save rating. Try again.');
    }
  }

  // Apply a status change via a full PUT. The whole `book` object is
  // spread in so the other bookColumns survive the round-trip (PUT
  // overwrites every bookColumn, so omitting one would null it).
  // Mirrors BookDetail's handleFinish payload shape.
  async function changeStatus(e, nextStatus) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    clearError();
    const today = new Date().toLocaleDateString('en-CA');
    let payload = {
      ...book,
      authors:     book.authors?.map(a => a.name) ?? [],
      narrators:   book.narrators?.map(n => n.name) ?? [],
      translators: book.translators?.map(t => t.name) ?? [],
      tags:        realTagNames(book.tags),
      status:      nextStatus,
    };
    if (nextStatus === 'finished') {
      // Auto-fill date_finished unless already set or previously_owned
      // (historical reads with unknown finish dates — keep null so the
      // user can fill in if they remember).
      payload.date_finished = book.date_finished
        || (book.previously_owned ? null : today);
    }
    if (nextStatus === 'reading' && !book.date_started) {
      payload.date_started = today;
    }
    try {
      await api.updateBook(book.id, payload);
      // Successful mutation clears any stale badge from a different
      // earlier action — auto-clear on menu reopen would only catch it
      // after the user clicks the button again, which can be many
      // seconds away.
      setActionError(null);
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
      // Mark-as-finished from a menu deserves a landing page for the
      // rate-and-review follow-up: jump to BookDetail and pass the
      // existing `justFinished` flag (same one Library's quick-edit
      // already uses) so the rating row reads "How was it?" — the same
      // prompt the user would see if they'd finished from the detail
      // page directly.
      if (nextStatus === 'finished' && !book.rating) {
        const state = returnState ?? { from: labelForPath(pathname), fromPath: pathname + search };
        navigate(`/books/${book.id}`, { state: { ...state, justFinished: true } });
      }
    } catch {
      setActionError('Failed to update status. Try again.');
    }
  }

  function handleEdit(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    // Prefer the parent's linkState — it carries the rich entity-aware
    // label the rest of the card uses (list name, author name, browse
    // facet value), where labelForPath would degrade to the index
    // label ("Lists", "Authors") and disagree with the path. Fall back
    // to a computed state for callers that don't pass one.
    const state = returnState ?? { from: labelForPath(pathname), fromPath: pathname + search };
    navigate(`/books/${book.id}/edit`, { state });
  }

  // Surface BookCard's inline progress editor from the menu — useful as
  // a keyboard-driven entry point when the cover's pencil button is
  // hover-revealed and hard to reach without a pointer. The editor is
  // owned by BookCard (which holds the form state); the parent passes
  // an opener callback in.
  function handleOpenProgress(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    onOpenProgress?.();
  }

  // Archive / Restore. PATCH-based (archived is in the patchBook
  // whitelist; the backend also auto-clears on_readlist when archiving).
  async function handleArchive(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    try {
      await api.patchBook(book.id, { archived: !book.archived });
      setActionError(null);
      dispatchSpineEvent('spine:book-mutated', { id: book.id });
    } catch {
      setActionError(book.archived
        ? 'Failed to restore from archive. Try again.'
        : 'Failed to archive book. Try again.');
    }
  }

  async function handleDelete(e) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    const ok = await confirm({
      title:        'Delete book',
      message:      `Delete "${book.title}"? This is permanent.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.deleteBook(book.id);
      // Card unmounts via spine:book-deleted on most surfaces, but a
      // parent could delay removal — keep the consistency with the
      // other mutation success paths.
      setActionError(null);
      dispatchSpineEvent('spine:book-deleted', { id: book.id });
    } catch {
      setActionError('Failed to delete book. Try again.');
    }
  }

  const dropdown = open && pos && createPortal(
    <div
      ref={dropdownRef}
      role="menu"
      aria-label={
        subPrompt === 'add-to-lists'   ? `Add ${book.title} to list`
        : subPrompt === 'shelf-location' ? `Choose a location for ${book.title}`
        : `Actions for ${book.title}`
      }
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight }}
      className="z-[9999] w-56 flex flex-col bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl"
      /* Stop clicks at the dropdown root so a miss on the dead space
         between buttons (py-1 padding, my-1 separators) doesn't bubble
         through the portal back into BookCard's wrapping <Link> and
         navigate to BookDetail. Each menu-item's own onClick already
         stops propagation; this catches the gaps. */
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Scrollable region — wraps both the root menu and the add-to-
          lists sub-prompt so the dropdown caps at 80vh in either state.
          NewListInput sits OUTSIDE this region as a sticky footer in
          sub-prompt mode so a long list of lists doesn't push the
          create affordance off-screen. min-h-0 lets this flex child
          shrink below content size. */}
      <div className="min-h-0 overflow-y-auto py-1">
      {subPrompt === 'add-to-lists' ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSubPrompt(null); }}
            className="w-full px-3 py-1.5 text-left text-[11px] text-neutral-500 hover:text-neutral-300 border-b border-neutral-800"
          >
            ← Back
          </button>
          {error && (
            <div role="none">
              <p role="alert" className="text-xs text-warn px-3 py-1.5 border-b border-neutral-800">{error}</p>
            </div>
          )}
          {loadingLists ? (
            <div role="none">
              <p role="status" className="text-xs text-neutral-600 px-3 py-2">Loading…</p>
            </div>
          ) : (
            <>
              {lists.length === 0 && (
                <p role="none" className="text-xs text-neutral-600 px-3 py-2">No lists yet. Create one below.</p>
              )}
              {lists.map(list => {
                const checked = memberIds.has(list.id);
                return (
                  <button
                    key={list.id}
                    type="button"
                    onClick={(e) => toggleList(e, list.id)}
                    disabled={busyIds.has(list.id)}
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-neutral-800 transition-colors disabled:opacity-60"
                  >
                    <span className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${checked ? 'bg-sky-500 border-sky-500' : 'border-neutral-600'}`}>
                      {checked && (
                        <svg viewBox="0 0 10 8" fill="none" className="w-2.5 h-2.5">
                          <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className={`truncate ${checked ? 'text-neutral-200' : 'text-neutral-400'}`} title={list.name}>{list.name}</span>
                  </button>
                );
              })}
            </>
          )}
        </>
      ) : subPrompt === 'shelf-location' ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSubPrompt(null); }}
            className="w-full px-3 py-1.5 text-left text-[11px] text-neutral-500 hover:text-neutral-300 border-b border-neutral-800"
          >
            ← Back
          </button>
          {currentLocationCrumb && (
            <div role="none" className="px-3 py-2 border-b border-neutral-800">
              <p className="text-[10px] text-neutral-600 uppercase tracking-wider mb-1">Currently on</p>
              <p className="text-xs text-neutral-300 truncate mb-1.5" title={currentLocationCrumb}>{currentLocationCrumb}</p>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeFromShelf(); }}
                disabled={placingKey != null}
                role="menuitem"
                className="text-[11px] text-neutral-500 hover:text-warn transition-colors disabled:opacity-60"
              >
                Remove from shelf
              </button>
            </div>
          )}
          <div role="none" className="px-2 py-1.5 border-b border-neutral-800" onMouseDown={(e) => e.stopPropagation()}>
            <input
              ref={shelfSearchRef}
              type="text"
              value={shelfQuery}
              onChange={(e) => setShelfQuery(e.target.value)}
              placeholder="Search shelves, rooms, units…"
              aria-label="Search locations"
              className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-parchment placeholder-neutral-600 focus:outline-none focus:border-oak/50"
            />
          </div>
          {shelfError && (
            <div role="none">
              <p role="alert" className="text-xs text-warn px-3 py-1.5 border-b border-neutral-800">{shelfError}</p>
            </div>
          )}
          {shelfLoading ? (
            <p role="status" className="text-xs text-neutral-600 px-3 py-2">Loading…</p>
          ) : flatLocations.length === 0 ? (
            <p className="text-xs text-neutral-600 px-3 py-2">No shelves configured yet.</p>
          ) : visibleLocations.length === 0 ? (
            <p className="text-xs text-neutral-600 px-3 py-2">No locations match.</p>
          ) : shelfQuery.trim() ? (
            /* Search mode — show full crumbs, no indent, no chevron. The
               user has narrowed already; flat list with breadcrumbs is
               the most informative shape. */
            visibleLocations.map(loc => (
              <button
                key={loc.key}
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); placeAt(loc); }}
                disabled={placingKey != null}
                role="menuitem"
                title={loc.crumb}
                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-800 hover:text-neutral-200 transition-colors disabled:opacity-60 flex items-center gap-2 ${
                  loc.level === 'shelf' ? 'text-neutral-300' : 'text-neutral-500'
                }`}
              >
                {loc.level !== 'shelf' && (
                  <span className="text-[8px] uppercase tracking-wider text-neutral-600 bg-neutral-800/60 px-1 py-0.5 rounded flex-shrink-0">
                    {loc.level === 'building' ? 'Bldg' : loc.level === 'room' ? 'Room' : 'Unit'}
                  </span>
                )}
                <span className="truncate">{loc.crumb}</span>
              </button>
            ))
          ) : (
            /* Browse mode — indented label tree with chevrons on
               expandable rows. Rows start collapsed; chevron toggles
               just that row's children. Clicking the label itself
               picks (PATCHes). */
            visibleLocations.map(loc => {
              const expandable = parentKeysWithChildren.has(loc.key);
              const expanded = expandedKeys.has(loc.key);
              return (
                <div key={loc.key} className="flex items-stretch hover:bg-neutral-800 transition-colors">
                  {expandable ? (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleExpand(loc.key); }}
                      aria-label={expanded ? `Collapse ${loc.label}` : `Expand ${loc.label}`}
                      aria-expanded={expanded}
                      className="flex-shrink-0 w-6 flex items-center justify-center text-neutral-600 hover:text-neutral-300 transition-colors"
                    >
                      <span aria-hidden="true" className="text-[10px]">{expanded ? '▾' : '▸'}</span>
                    </button>
                  ) : (
                    <span aria-hidden="true" className="flex-shrink-0 w-6" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); placeAt(loc); }}
                    disabled={placingKey != null}
                    role="menuitem"
                    title={loc.crumb}
                    style={{ paddingLeft: loc.depth * 10 }}
                    className={`flex-1 min-w-0 pr-3 py-1.5 text-left text-xs transition-colors disabled:opacity-60 flex items-center gap-1.5 ${
                      loc.level === 'shelf' ? 'text-neutral-300' : 'text-neutral-400'
                    } hover:text-neutral-200`}
                  >
                    {loc.level !== 'shelf' && (
                      <span className="text-[8px] uppercase tracking-wider text-neutral-600 bg-neutral-800/60 px-1 py-0.5 rounded flex-shrink-0">
                        {loc.level === 'building' ? 'Bldg' : loc.level === 'room' ? 'Room' : 'Unit'}
                      </span>
                    )}
                    <span className="truncate">{loc.label}</span>
                  </button>
                </div>
              );
            })
          )}
        </>
      ) : (
        <>
          {/* Inline star rating — clicks fire optimistic PUTs; the menu
              stays open so the user can adjust further or move on to
              another item. onMouseDown on the wrapper stops the outside-
              click handler (registered on document.mousedown) from
              firing on the dead space between stars. */}
          <div
            role="none"
            className="px-3 py-2 border-b border-neutral-800 flex justify-center"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <StarRating
              value={localRating}
              onChange={handleRate}
              size="text-3xl"
              ariaLabel={`Rating for ${book.title}`}
            />
          </div>
          {onOpenProgress && book.status === 'reading' && (
            <button type="button" onClick={handleOpenProgress} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Update progress…
            </button>
          )}
          {book.status !== 'finished' && (
            <button type="button" onClick={(e) => changeStatus(e, 'finished')} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Mark as finished
            </button>
          )}
          {book.status !== 'reading' && (
            <button type="button" onClick={(e) => changeStatus(e, 'reading')} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Mark as reading
            </button>
          )}
          {book.status !== 'unread' && (
            <button type="button" onClick={(e) => changeStatus(e, 'unread')} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Mark as unread
            </button>
          )}
          <div role="separator" aria-orientation="horizontal" className="my-1 border-t border-neutral-800" />
          <button type="button" onClick={openListsSubPrompt} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            Add to lists…
          </button>
          {canShelve && (
            <button type="button" onClick={openShelfSubPrompt} role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
              Location…
            </button>
          )}
          <button type="button" onClick={handleEdit} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            Edit book…
          </button>
          <button type="button" onClick={handleArchive} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 transition-colors">
            {book.archived ? 'Restore from archive' : 'Archive book'}
          </button>
          <div role="separator" aria-orientation="horizontal" className="my-1 border-t border-neutral-800" />
          <button type="button" onClick={handleDelete} role="menuitem"
            className="w-full px-3 py-2 text-left text-sm text-warn hover:bg-warn/10 transition-colors">
            Delete book…
          </button>
        </>
      )}
      </div>
      {/* Sticky create-list footer — only in the add-to-lists sub-prompt,
          and only once the initial load has resolved (so the input
          doesn't appear next to a "Loading…" line in the scroll area). */}
      {subPrompt === 'add-to-lists' && !loadingLists && (
        <div className="flex-shrink-0">
          <NewListInput
            onCreate={createListAndAdd}
            creating={creating}
            createError={createError}
            clearCreateError={clearCreateError}
          />
        </div>
      )}
    </div>,
    document.body
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        aria-label={actionError
          ? `${actionError} Open actions for ${book.title}.`
          : `More actions for ${book.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={actionError ?? 'More actions'}
        className={`leading-none transition-colors ${
          actionError ? 'text-warn hover:text-warn/80' : 'text-white hover:text-neutral-300'
        } ${buttonClassName}`}
      >
        {actionError
          ? <span aria-hidden="true" className={`inline-flex items-center justify-center font-bold ${iconClassName}`}>!</span>
          : <DotsIcon className={iconClassName} />}
      </button>
      {/* The icon swap and aria-label update tell sighted users + AT
          users who focus the button, but a passive AT user whose focus
          is elsewhere wouldn't hear about the failure. role="alert" is
          implicitly assertive — announces on change. */}
      {actionError && (
        <span role="alert" className="sr-only">{actionError}</span>
      )}
      {dropdown}
    </>
  );
}
