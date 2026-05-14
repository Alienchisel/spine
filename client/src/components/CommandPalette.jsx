import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

// Global command palette, opened with Ctrl/Cmd+Shift+P. Phase 1 surfaces
// book search only: fuzzy/FTS via the existing /api/books?q= search,
// debounced 200ms, capped at 20 results. Enter (or click) navigates to
// the book's detail page.
//
// Future phases will add navigation entries (top-level views, lists,
// authors), actions (mark finished, toggle loved, change theme), and
// context-aware book-scoped commands on a book detail page. See the
// design sketch in the project conversation for the phased plan.

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Element to refocus when the palette closes — usually the page-level
  // control the user was last on before opening. Mirrors the focus-
  // restoration pattern in ConfirmModal so keyboard users aren't
  // dumped to <body>.
  const returnFocusRef = useRef(null);
  // Stale-response guard: rapid typing fires multiple in-flight searches;
  // earlier ones must not overwrite results from a later query.
  const queryGenRef = useRef(0);
  const navigate = useNavigate();

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setSelected(0);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && typeof target.focus === 'function') {
      requestAnimationFrame(() => target.focus());
    }
  }, []);

  // Global open shortcut. Both bindings are intentional:
  //   - Ctrl/Cmd+K — the modern convention (Linear/Slack/GitHub/Notion)
  //     and Firefox-friendly. Firefox's Ctrl+Shift+P opens a Private
  //     Window at the browser-chrome level and can't be intercepted
  //     by preventDefault, so K is the only universally-working binding.
  //   - Ctrl/Cmd+Shift+P — the VS Code convention. Useful on Chrome/
  //     Edge/Safari where it isn't browser-bound; ignored on Firefox.
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

  // Debounced search. Empty query → no results (the open palette shows
  // just the input; phase 5 will fill the empty state with recent /
  // suggested entries).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const gen = ++queryGenRef.current;
    const t = setTimeout(async () => {
      try {
        const { books } = await api.getBooks({ q, limit: 20 });
        if (gen !== queryGenRef.current) return;  // newer query already fired
        setResults(books);
        setSelected(0);
      } catch {
        if (gen !== queryGenRef.current) return;
        setResults([]);
      } finally {
        if (gen === queryGenRef.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  // Keep the selected row visible when navigated past the viewport edge.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.children[selected];
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  function pick(book) {
    if (!book) return;
    close();
    navigate(`/books/${book.id}`);
  }

  function handleKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[selected]);
    }
  }

  if (!open) return null;

  const showEmptyMessage = query.trim() && !loading && results.length === 0;

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
          placeholder="Search your library…"
          aria-label="Search library"
          aria-autocomplete="list"
          className="w-full bg-neutral-900 border-b border-neutral-800 px-4 py-3 text-sm text-white placeholder-neutral-600 focus:outline-none"
        />
        {loading && results.length === 0 && (
          <p role="status" className="px-4 py-3 text-xs text-neutral-600">Searching…</p>
        )}
        {results.length > 0 && (
          <ul ref={listRef} className="max-h-[60vh] overflow-y-auto">
            {results.map((book, i) => (
              <li key={book.id}>
                <button
                  type="button"
                  onClick={() => pick(book)}
                  onMouseEnter={() => setSelected(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selected ? 'bg-neutral-800' : 'hover:bg-neutral-800/60'
                  }`}
                >
                  {book.cover_path ? (
                    <img src={book.cover_path} alt="" className="w-8 h-12 object-cover rounded flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-12 bg-neutral-800 rounded flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{book.title}</p>
                    {book.authors?.length > 0 && (
                      <p className="text-xs text-neutral-500 truncate">
                        {book.authors.map(a => a.name).join(', ')}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
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
