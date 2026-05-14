import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';

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
//
// Future phases will add context-aware book-detail actions, sub-prompts,
// and an empty-state recent / suggested layer.

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

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setBookResults([]);
    setSelected(0);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && typeof target.focus === 'function') {
      requestAnimationFrame(() => target.focus());
    }
  }, []);

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

  // Library actions are URL-driven. When already on Library, preserve
  // other params (tab, q, filters) and just update the one we care
  // about; when elsewhere, navigate to a fresh Library view. Both
  // branches read the *current* URL at the moment of invocation, so
  // memoizing the actions array on `searchParams` is intentional.
  const actionEntries = useMemo(() => {
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

  // Build the sectioned result set. Memoized so arrow-key navigation
  // doesn't recompute on every render. Each entry carries everything
  // needed to render and execute it (path OR perform).
  const { sections, flat } = useMemo(() => {
    const q = query.trim().toLowerCase();

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

    const _sections = [
      { kind: 'nav',    label: 'Navigate', entries: navEntries },
      { kind: 'action', label: 'Actions',  entries: matchedActions },
      { kind: 'list',   label: 'Lists',    entries: listEntries },
      { kind: 'book',   label: 'Books',    entries: bookEntries },
    ].filter(s => s.entries.length > 0);

    return { sections: _sections, flat: _sections.flatMap(s => s.entries) };
  }, [query, lists, bookResults, actionEntries]);

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

  function pick(entry) {
    if (!entry) return;
    close();
    if (entry.perform) entry.perform();
    else if (entry.path) navigate(entry.path);
  }

  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
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
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search library, lists, or navigate…"
          aria-label="Command palette search"
          aria-autocomplete="list"
          className="w-full bg-neutral-900 border-b border-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none"
        />
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
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
