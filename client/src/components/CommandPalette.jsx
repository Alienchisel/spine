import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams, useMatch } from 'react-router-dom';
import { api } from '../api.js';
import { useConfirm } from './ConfirmModal.jsx';

// Global command palette, opened with Ctrl/Cmd+K (universal) or
// Ctrl/Cmd+Shift+P (VS Code muscle memory; Chrome/Edge/Safari only —
// Firefox reserves it for Private Window at the browser level).
//
// Phase 1: book search via /api/books?q= (debounced 200ms, capped 20).
// Phase 2: navigation entries (top-level views + Library tabs) and
//   user-created lists, both filtered client-side. Sections group the
//   kinds (Navigate / Actions / Lists / Books); arrow keys traverse the
//   flat list across sections.
// Phase 3: Library actions — clear filters, change sort. URL-driven,
//   so they preserve other params when invoked on Library and
//   navigate to a fresh Library view when invoked elsewhere.
// Phase 4: context-aware book-detail actions — toggle loved / readlist
//   / archive (PATCH-based), edit book (navigate), delete book (confirm
//   + delete + navigate to /). Only surface when on /books/:id. After a
//   mutating action, dispatch spine:book-mutated so BookDetail refreshes
//   without a navigation.
// Phase 5: empty-state layer — Continue reading (top 3 books with
//   status='reading', refetched per open) and Recent (top 3 MRU entries
//   from localStorage). Library actions hide in the empty state so the
//   10-similar-sort-options block doesn't dominate; they surface when
//   the user types. Book-scoped action ids (book.toggle-loved, etc.)
//   aren't added to the MRU since their target depends on which detail
//   page is open at execution time.
// Phase 6: sub-prompts — actions that need a parameter (Add to list…)
//   push a one-level picker state. Escape from a sub-prompt returns to
//   root rather than closing. Sub-prompt pick ids (pick-list.X) aren't
//   persisted in MRU since they're ephemeral.

// Static navigation entries. Paths must match main.jsx routes. The
// Library tabs reuse the same path with a query string the existing
// urlState reader picks up.
const NAV_ENTRIES = [
  { id: 'nav.library',              label: 'Library',              hint: 'All books',                path: '/' },
  { id: 'nav.library.reading',      label: 'Reading',              hint: 'Library — Reading tab',    path: '/?tab=reading' },
  { id: 'nav.library.finished',     label: 'Finished',             hint: 'Library — Finished tab',   path: '/?tab=finished' },
  { id: 'nav.library.unread',       label: 'Unread',               hint: 'Library — Unread tab',     path: '/?tab=unread' },
  { id: 'nav.library.owned',        label: 'Owned',                hint: 'Library — Owned tab',      path: '/?tab=owned' },
  { id: 'nav.library.prev_owned',   label: 'Previously owned',     hint: 'Library — Prev. owned',    path: '/?tab=prev_owned' },
  { id: 'nav.library.never_owned',  label: 'Never owned',          hint: 'Library — Never owned',    path: '/?tab=never_owned' },
  { id: 'nav.library.archived',     label: 'Archived',             hint: 'Library — Archived tab',   path: '/?tab=archived' },
  { id: 'nav.library.custom',       label: 'Custom collections',   hint: 'Library — custom only',    path: '/?tab=all&custom=true' },
  { id: 'nav.readlist',             label: 'Readlist',                                              path: '/readlist' },
  { id: 'nav.loved',                label: 'Loved',                                                 path: '/loved' },
  { id: 'nav.lists',                label: 'Lists',                hint: 'All lists',                path: '/lists' },
  { id: 'nav.diary',                label: 'Diary',                                                 path: '/diary' },
  { id: 'nav.stats',                label: 'Stats',                                                 path: '/stats' },
  { id: 'nav.shelf',                label: 'Shelf manager',                                         path: '/shelf' },
  { id: 'nav.shelf-view',           label: 'Shelf view',                                            path: '/shelf-view' },
  { id: 'nav.new',                  label: 'Add a new book',       hint: 'Open the new-book form',   path: '/books/new' },
];

// Mirror of the SORTS array in pages/Library.jsx. Kept as a local copy
// rather than imported to keep the palette decoupled from page internals
// — if Library renames a sort key, both files need updating, but the
// keys are part of the URL contract anyway so this is a stable surface.
const SORTS = [
  { key: 'updated',     label: 'Recently updated' },
  { key: 'last_logged', label: 'Recently logged' },
  { key: 'added',       label: 'Recently added' },
  { key: 'author',      label: 'Author A–Z' },
  { key: 'title',       label: 'Title A–Z' },
  { key: 'rating',      label: 'Rating' },
  { key: 'progress',    label: 'Progress' },
  { key: 'started',     label: 'Date started' },
  { key: 'finished',    label: 'Date finished' },
];

// Simple case-insensitive substring match — sufficient for nav, action,
// and list filtering (small sets, exact-feeling matches). Book search
// stays on the backend FTS path for its smarter ranking.
function matchesQuery(text, q) {
  if (!q) return true;
  return text.toLowerCase().includes(q);
}

const MRU_KEY = 'spine-palette-mru';
const MRU_MAX = 20;

function loadMRU() {
  try {
    const raw = localStorage.getItem(MRU_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveMRU(items) {
  try { localStorage.setItem(MRU_KEY, JSON.stringify(items)); } catch {}
}

// Book-scoped action ids don't belong in MRU — their target is whichever
// book detail page is open at execution time, so showing 'Mark as loved'
// in Recent would mislead the user about *which* book it toggles.
// Sub-prompt pick entries (pick-list.X, etc.) are also ephemeral — they
// only exist while a sub-prompt is open, so persisting them would
// surface them as Recent items the user can't directly invoke.
function isPersistableForRecent(entry) {
  if (entry.id.startsWith('pick-')) return false;
  if (entry.kind === 'action' && entry.id.startsWith('book.')) return false;
  return true;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bookResults, setBookResults] = useState([]);
  const [bookLoading, setBookLoading] = useState(false);
  const [lists, setLists] = useState([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Element to refocus when the palette closes — usually the page-level
  // control the user was last on. Mirrors ConfirmModal's pattern so
  // keyboard users aren't dumped to <body>.
  const returnFocusRef = useRef(null);
  // Stale-response guard: rapid typing fires multiple in-flight searches;
  // earlier ones must not overwrite results from a later query.
  const queryGenRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOnLibrary = location.pathname === '/';
  const confirm = useConfirm();
  // Exact match on /books/:id — excludes /books/new (no numeric id),
  // /books/:id/edit (longer path), and any other /books/* subpath.
  // We further guard on a numeric id below so a future /books/foo
  // doesn't accidentally activate book actions.
  const bookMatch = useMatch('/books/:id');
  const currentBookId = bookMatch && /^\d+$/.test(bookMatch.params.id)
    ? Number(bookMatch.params.id)
    : null;
  const [currentBook, setCurrentBook] = useState(null);
  const [reading, setReading] = useState([]);
  const [recent, setRecent] = useState(loadMRU);
  // Sub-prompt state. null when in root mode; otherwise { action,
  // bookId, bookTitle } describing the parameter-picker currently
  // active. Escape returns to root before closing the whole palette.
  const [subPrompt, setSubPrompt] = useState(null);
  // Inline error surfaced in sub-prompt mode when a pick fails. Cleared
  // automatically on input change and on sub-prompt entry/exit so it
  // doesn't sit stale after a retry.
  const [subPromptError, setSubPromptError] = useState(null);

  // Reset query / results / selection without dismissing the palette
  // — used both by close() and by sub-prompt transitions, where we
  // want a fresh input but want to stay open.
  const resetQuery = useCallback(() => {
    setQuery('');
    setBookResults([]);
    setSelected(0);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    resetQuery();
    setSubPrompt(null);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && typeof target.focus === 'function') {
      requestAnimationFrame(() => target.focus());
    }
  }, [resetQuery]);

  // Open shortcut. See header comment for binding rationale.
  useEffect(() => {
    function onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const isCmdK = !e.shiftKey && k === 'k';
      const isCmdShiftP = e.shiftKey && k === 'p';
      if (!isCmdK && !isCmdShiftP) return;
      e.preventDefault();
      if (open) { close(); return; }
      returnFocusRef.current = document.activeElement;
      setOpen(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Focus the input once mounted.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Lazy-load user lists on first open. Cached for the session; a long-
  // lived tab will see stale list names if they're renamed elsewhere,
  // but that's a tolerable cost vs. fetching on every open. Phase 5
  // can revisit if it matters.
  useEffect(() => {
    if (!open || listsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getLists();
        if (!cancelled) setLists(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setLists([]);
      } finally {
        if (!cancelled) setListsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, listsLoaded]);

  // Fetch the current book whenever the palette opens on /books/:id.
  // Re-fetching per open (rather than caching) keeps the loved /
  // readlist / archive labels accurate after the user mutates state
  // on the detail page itself.
  useEffect(() => {
    if (!open || currentBookId == null) {
      setCurrentBook(null);
      return;
    }
    let cancelled = false;
    api.getBook(currentBookId)
      .then(b => { if (!cancelled) setCurrentBook(b); })
      .catch(() => { if (!cancelled) setCurrentBook(null); });
    return () => { cancelled = true; };
  }, [open, currentBookId]);

  // Continue-reading: fetch every time the palette opens. The set is
  // tiny (3 books) and the user might have flipped status elsewhere
  // between opens, so the cost of a refetch is worth the freshness.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.getBooks({ statuses: 'reading', sort: 'updated', limit: 3 })
      .then(d => { if (!cancelled) setReading(d.books || []); })
      .catch(() => { if (!cancelled) setReading([]); });
    return () => { cancelled = true; };
  }, [open]);

  const remember = useCallback((entry) => {
    if (!entry || !isPersistableForRecent(entry)) return;
    // Strip non-serializable bits (perform fn closures); we re-bind the
    // action's perform() from the live registry when rendering Recent.
    const stripped = {
      id:    entry.id,
      kind:  entry.kind,
      label: entry.label,
      hint:  entry.hint ?? null,
      path:  entry.path ?? null,
      cover: entry.cover ?? null,
      ts:    Date.now(),
    };
    setRecent(prev => {
      const filtered = prev.filter(p => p.id !== stripped.id);
      const next = [stripped, ...filtered].slice(0, MRU_MAX);
      saveMRU(next);
      return next;
    });
  }, []);

  // Remove a specific entry from MRU. Used when an action deletes the
  // resource it points at — without this, the deleted book would keep
  // surfacing in Recent until naturally aged off the 20-cap, and
  // clicking it would route to a 404 detail page.
  const forget = useCallback((id) => {
    setRecent(prev => {
      const next = prev.filter(p => p.id !== id);
      saveMRU(next);
      return next;
    });
  }, []);

  // Debounced book search. Empty query → no books (we still show the
  // nav directory; books wait for a real query because they're a
  // round-trip).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setBookResults([]);
      setBookLoading(false);
      return;
    }
    setBookLoading(true);
    const gen = ++queryGenRef.current;
    const t = setTimeout(async () => {
      try {
        const { books } = await api.getBooks({ q, limit: 20 });
        if (gen !== queryGenRef.current) return;
        setBookResults(books);
      } catch {
        if (gen !== queryGenRef.current) return;
        setBookResults([]);
      } finally {
        if (gen === queryGenRef.current) setBookLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  // Clear any stale sub-prompt error when the user keeps typing or
  // when the sub-prompt itself toggles. Prevents a "failed" message
  // from sitting next to an unrelated filter the user has narrowed to.
  useEffect(() => { setSubPromptError(null); }, [query, subPrompt]);

  // Library actions are URL-driven. When already on Library, preserve
  // other params (tab, q, filters) and just update the one we care
  // about; when elsewhere, navigate to a fresh Library view. Both
  // branches read the *current* URL at the moment of invocation, so
  // memoizing the actions array on `searchParams` is intentional.
  const libraryActions = useMemo(() => {
    const onLibrary = isOnLibrary;
    const currentParams = searchParams;

    const changeSort = (key) => () => {
      if (onLibrary) {
        const next = new URLSearchParams(currentParams);
        next.set('sort', key);
        setSearchParams(next);
      } else {
        navigate(`/?sort=${key}`);
      }
    };

    const clearAll = () => navigate('/');

    return [
      {
        id: 'action.clear',
        kind: 'action',
        label: 'Clear filters and search',
        hint: 'Library — reset to default view',
        perform: clearAll,
      },
      ...SORTS.map(s => ({
        id: `action.sort.${s.key}`,
        kind: 'action',
        label: `Sort by ${s.label}`,
        hint: 'Library',
        perform: changeSort(s.key),
      })),
    ];
  }, [isOnLibrary, searchParams, navigate, setSearchParams]);

  // Book-detail actions — only present when on /books/:id and the book
  // has loaded. Mutating actions hit the PATCH endpoint and then
  // dispatch spine:book-mutated; BookDetail listens and refetches so
  // the page reflects the change without a navigation. Delete uses
  // useConfirm() (the palette is mounted under ConfirmModalProvider)
  // and navigates back to Library on success.
  const bookActions = useMemo(() => {
    if (!currentBook) return [];
    const id = currentBook.id;
    const title = currentBook.title;
    const fireMutation = () => window.dispatchEvent(new CustomEvent('spine:book-mutated', { detail: { id } }));

    return [
      {
        id: 'book.toggle-loved',
        kind: 'action',
        label: currentBook.loved ? 'Remove from loved' : 'Mark as loved',
        hint: title,
        perform: async () => { await api.patchBook(id, { loved: !currentBook.loved }); fireMutation(); },
      },
      {
        id: 'book.toggle-readlist',
        kind: 'action',
        label: currentBook.on_readlist ? 'Remove from readlist' : 'Add to readlist',
        hint: title,
        perform: async () => { await api.patchBook(id, { on_readlist: !currentBook.on_readlist }); fireMutation(); },
      },
      {
        id: 'book.toggle-archive',
        kind: 'action',
        label: currentBook.archived ? 'Restore from archive' : 'Archive book',
        hint: title,
        perform: async () => { await api.patchBook(id, { archived: !currentBook.archived }); fireMutation(); },
      },
      {
        id: 'book.add-to-list',
        kind: 'action',
        label: 'Add to list…',
        hint: title,
        // keepOpen: this entry transitions into a sub-prompt rather
        // than completing an action, so we don't dismiss the palette
        // when the user picks it.
        keepOpen: true,
        perform: () => {
          setSubPrompt({ action: 'add-to-list', bookId: id, bookTitle: title });
          resetQuery();
        },
      },
      {
        id: 'book.edit',
        kind: 'action',
        label: 'Edit book…',
        hint: title,
        perform: () => navigate(`/books/${id}/edit`),
      },
      {
        id: 'book.delete',
        kind: 'action',
        label: 'Delete book…',
        hint: title,
        perform: async () => {
          const ok = await confirm({
            title: 'Delete book',
            message: `Delete "${title}"? This is permanent.`,
            confirmLabel: 'Delete',
          });
          if (!ok) return;
          await api.deleteBook(id);
          forget(`book.${id}`);
          navigate('/');
        },
      },
    ];
  }, [currentBook, navigate, confirm, resetQuery, forget]);

  const actionEntries = useMemo(() => [...bookActions, ...libraryActions], [bookActions, libraryActions]);

  // Empty-state entry sets. Continue-reading maps the fetched book
  // objects to entry shape; recent rehydrates persisted MRU entries,
  // re-binding action perform() functions from the live registry so
  // a stored Library action still works after a reload. Entries whose
  // live counterpart no longer exists (e.g. a deleted book in MRU,
  // or a book-scoped action whose page isn't open) are filtered out.
  //
  // Continue-reading drops the book the user is currently viewing —
  // surfacing 'the book I'm looking at' is just noise. Recent drops
  // anything already in Continue-reading so the same book doesn't
  // appear twice on the surface.
  const continueEntries = useMemo(() => reading
    .filter(b => b.id !== currentBookId)
    .map(b => ({
      id:    `book.${b.id}`,
      kind:  'book',
      label: b.title,
      hint:  b.authors?.map(a => a.name).join(', ') || null,
      cover: b.cover_path,
      path:  `/books/${b.id}`,
    })), [reading, currentBookId]);

  const recentEntries = useMemo(() => {
    const continueIds = new Set(continueEntries.map(e => e.id));
    return recent
      .map(r => {
        if (r.kind === 'action') {
          const live = actionEntries.find(a => a.id === r.id);
          return live || null;
        }
        return r;
      })
      .filter(Boolean)
      .filter(e => !continueIds.has(e.id))
      .slice(0, 3);
  }, [recent, actionEntries, continueEntries]);

  // Build the sectioned result set. Memoized so arrow-key navigation
  // doesn't recompute on every render. Three modes:
  //   1. Sub-prompt mode: show the parameter picker only (lists for
  //      'add-to-list'). Other sections are suppressed so the user
  //      stays focused on the choice they're making.
  //   2. Empty root: pre-curated discovery (Continue reading, Recent,
  //      Book actions, the static directory).
  //   3. Query root: everything filtered by the input.
  const { sections, flat } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const isEmpty = q === '';

    let _sections;

    if (subPrompt?.action === 'add-to-list') {
      const matched = lists
        .filter(l => matchesQuery(l.name, q))
        .map(l => ({
          id: `pick-list.${l.id}`,
          kind: 'list',
          label: l.name,
          hint: l.book_count != null ? `${l.book_count} book${l.book_count === 1 ? '' : 's'}` : null,
          perform: async () => {
            setSubPromptError(null);
            try {
              await api.addToList(l.id, subPrompt.bookId);
              window.dispatchEvent(new CustomEvent('spine:book-mutated', { detail: { id: subPrompt.bookId } }));
            } catch (err) {
              // Surface the failure inline so the user knows the add
              // didn't take, then re-throw so pick() skips its close().
              setSubPromptError(`Failed to add to "${l.name}"`);
              throw err;
            }
          },
        }));
      _sections = [
        { kind: 'pick', label: `Add "${subPrompt.bookTitle}" to…`, entries: matched },
      ];
    } else if (isEmpty) {
      // Pre-curated empty state. Library actions are suppressed here —
      // they'd add 10 similar-looking 'Sort by ...' rows and dominate
      // the surface. Users discover them by typing or via Recent once
      // they've used them. Book actions stay visible when on a detail
      // page since they're the obvious thing to reach for there.
      const listEntries = lists.map(l => ({
        id: `list.${l.id}`,
        kind: 'list',
        label: l.name,
        hint: l.book_count != null ? `${l.book_count} book${l.book_count === 1 ? '' : 's'}` : null,
        path: `/lists/${l.id}`,
      }));

      _sections = [
        { kind: 'continue', label: 'Continue reading', entries: continueEntries },
        { kind: 'recent',   label: 'Recent',           entries: recentEntries },
        { kind: 'action',   label: 'Book actions',     entries: bookActions },
        { kind: 'nav',      label: 'Navigate',         entries: NAV_ENTRIES.map(e => ({ ...e, kind: 'nav' })) },
        { kind: 'list',     label: 'Lists',            entries: listEntries },
      ];
    } else {
      const navEntries = NAV_ENTRIES
        .filter(e => matchesQuery(e.label, q) || (e.hint && matchesQuery(e.hint, q)))
        .map(e => ({ ...e, kind: 'nav' }));

      const matchedActions = actionEntries
        .filter(e => matchesQuery(e.label, q) || (e.hint && matchesQuery(e.hint, q)));

      const listEntries = lists
        .filter(l => matchesQuery(l.name, q))
        .map(l => ({
          id: `list.${l.id}`,
          kind: 'list',
          label: l.name,
          hint: l.book_count != null ? `${l.book_count} book${l.book_count === 1 ? '' : 's'}` : null,
          path: `/lists/${l.id}`,
        }));

      const bookEntries = bookResults.map(b => ({
        id: `book.${b.id}`,
        kind: 'book',
        label: b.title,
        hint: b.authors?.map(a => a.name).join(', ') || null,
        cover: b.cover_path,
        path: `/books/${b.id}`,
      }));

      _sections = [
        { kind: 'nav',    label: 'Navigate', entries: navEntries },
        { kind: 'action', label: 'Actions',  entries: matchedActions },
        { kind: 'list',   label: 'Lists',    entries: listEntries },
        { kind: 'book',   label: 'Books',    entries: bookEntries },
      ];
    }

    _sections = _sections.filter(s => s.entries.length > 0);
    return { sections: _sections, flat: _sections.flatMap(s => s.entries) };
  }, [query, lists, bookResults, actionEntries, bookActions, continueEntries, recentEntries, subPrompt]);

  // Clamp the selected index whenever the result set shrinks (e.g.
  // user typed a more restrictive query). Reset to 0 on each query
  // change so the user sees the top match highlighted.
  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    if (selected >= flat.length) setSelected(Math.max(0, flat.length - 1));
  }, [flat.length, selected]);

  // Keep the selected row visible when navigated past the viewport edge.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector(`[data-row-index="${selected}"]`);
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  async function pick(entry) {
    if (!entry) return;
    // Sub-prompt activator: synchronous transition into a picker
    // (no API call); remember on entry and stay open.
    if (entry.keepOpen) {
      remember(entry);
      if (entry.perform) entry.perform();
      return;
    }
    // Mutating or navigating entries: await perform so a failure can
    // keep the palette open with an inline error (the perform itself
    // sets the visible error state and re-throws). Successful picks
    // and pure-navigation picks fall through to remember + close +
    // optional navigate.
    if (entry.perform) {
      try {
        await entry.perform();
      } catch {
        return;
      }
    }
    remember(entry);
    close();
    if (entry.path) navigate(entry.path);
  }

  function handleKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // From a sub-prompt, Escape returns to root rather than closing
      // the whole palette — gives the user a one-step undo of the
      // 'I picked the wrong action' case.
      if (subPrompt) {
        setSubPrompt(null);
        resetQuery();
      } else {
        close();
      }
      return;
    }
    if (flat.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(i => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(flat[selected]);
    }
  }

  if (!open) return null;

  const showEmptyMessage = query.trim() && !bookLoading && flat.length === 0;
  // Running index across sections so each visible row has a unique
  // flat position the keyboard handler can match.
  let flatIdx = 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
      <div className="relative w-full max-w-xl rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl overflow-hidden">
        {subPrompt && (
          <div className="px-4 py-1.5 border-b border-neutral-800 bg-neutral-950 text-[11px] text-neutral-500 flex items-center gap-1.5">
            <span className="text-oak">→</span>
            <span>Add to list</span>
            <span className="text-neutral-700">·</span>
            <span className="truncate">{subPrompt.bookTitle}</span>
            <span className="ml-auto text-neutral-700">esc to cancel</span>
          </div>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder={subPrompt ? 'Pick a list…' : 'Search library, lists, or navigate…'}
          aria-label={subPrompt ? 'Pick a list' : 'Command palette search'}
          aria-autocomplete="list"
          className="w-full bg-neutral-900 border-b border-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none"
        />
        {subPrompt && subPromptError && (
          <p role="alert" className="px-4 py-2 text-xs text-warn border-b border-neutral-800">
            {subPromptError}
          </p>
        )}
        {bookLoading && bookResults.length === 0 && query.trim() && (
          <p role="status" className="px-4 py-3 text-xs text-neutral-600">Searching…</p>
        )}
        {flat.length > 0 && (
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
            {sections.map(section => (
              <div key={section.kind}>
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">
                  {section.label}
                </p>
                <ul>
                  {section.entries.map(entry => {
                    const idx = flatIdx++;
                    const isSelected = idx === selected;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          data-row-index={idx}
                          onClick={() => pick(entry)}
                          onMouseEnter={() => setSelected(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                            isSelected ? 'bg-neutral-800' : 'hover:bg-neutral-800/60'
                          }`}
                        >
                          {entry.kind === 'book' ? (
                            entry.cover ? (
                              <img src={entry.cover} alt="" className="w-8 h-12 object-cover rounded flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-12 bg-neutral-800 rounded flex-shrink-0" />
                            )
                          ) : (
                            <div className="w-6 flex-shrink-0 text-neutral-600 text-xs">
                              {entry.kind === 'nav'    ? '→'
                                : entry.kind === 'action' ? '⚡'
                                : '☰'}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white truncate">{entry.label}</p>
                            {entry.hint && (
                              <p className="text-xs text-neutral-500 truncate">{entry.hint}</p>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {showEmptyMessage && (
          <p role="status" className="px-4 py-3 text-xs text-neutral-600">No matches.</p>
        )}
        <div className="border-t border-neutral-800 px-4 py-2 text-[10px] text-neutral-600 flex items-center justify-between">
          <span>{subPrompt ? '↑↓ navigate · ↵ select · esc back' : '↑↓ navigate · ↵ open · esc close'}</span>
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
