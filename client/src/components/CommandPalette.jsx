import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams, useMatch } from 'react-router-dom';
import { api } from '../api.js';
import { plural, pluralWord, initialsFor, MOD_KEY, labelForPath } from '../utils.js';
import { useConfirm } from './ConfirmModal.jsx';
import { useStaleGuard } from '../hooks/useStaleGuard.js';
import { useSpineEvent, dispatchSpineEvent } from '../hooks/useSpineEvent.js';

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
//   preserving other params on the current tab. Only surfaced when on
//   Library (no current tab to sort or filters to clear elsewhere); sort
//   entries are further filtered to those allowed on the active tab.
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
  { id: 'nav.library',              label: 'Library',              hint: 'All books',                path: '/?tab=all' },
  { id: 'nav.library.reading',      label: 'Reading',              hint: 'Library — Reading tab',    path: '/?tab=reading' },
  { id: 'nav.library.finished',     label: 'Finished',             hint: 'Library — Finished tab',   path: '/?tab=finished' },
  { id: 'nav.library.unread',       label: 'Unread',               hint: 'Library — Unread tab',     path: '/?tab=unread' },
  { id: 'nav.library.owned',        label: 'Owned',                hint: 'Library — Owned tab',      path: '/?tab=owned' },
  { id: 'nav.library.prev_owned',   label: 'Previously owned',     hint: 'Library — Prev. owned',    path: '/?tab=prev_owned' },
  { id: 'nav.library.never_owned',  label: 'Never owned',          hint: 'Library — Never owned',    path: '/?tab=never_owned' },
  { id: 'nav.library.archived',     label: 'Archived',             hint: 'Library — Archived tab',   path: '/?tab=archived' },
  { id: 'nav.library.custom',       label: 'Custom collections',   hint: 'Library — custom only',    path: '/?tab=all&custom=true' },
  { id: 'nav.library.missing_binding', label: 'Missing binding',   hint: 'Library curation',         path: '/?tab=all&missing=binding' },
  { id: 'nav.readlist',             label: 'Readlist',                                              path: '/readlist' },
  { id: 'nav.loved',                label: 'Loved',                                                 path: '/loved' },
  { id: 'nav.lists',                label: 'Lists',                hint: 'All lists',                path: '/lists' },
  { id: 'nav.diary',                label: 'Diary',                                                 path: '/diary' },
  { id: 'nav.stats',                label: 'Stats',                                                 path: '/stats' },
  { id: 'nav.authors',              label: 'Authors',              hint: 'Author index',             path: '/authors' },
  { id: 'nav.tags',                 label: 'Tags',                 hint: 'Tag index',                path: '/tags' },
  { id: 'nav.series',               label: 'Series',               hint: 'Series index',             path: '/series' },
  { id: 'nav.shelf',                label: 'Shelf manager',                                         path: '/shelf' },
  { id: 'nav.shelf-view',           label: 'Shelf view',                                            path: '/shelf-view' },
  { id: 'nav.new',                  label: 'Add a new book',       hint: 'Open the new-book form',   path: '/books/new' },
];

// Small status-dot palette used on book rows. The three book statuses
// (reading / finished / unread) get a 1.5×1.5 dot before the title so
// the user can scan a result set and instantly tell which books are
// in which state. Colours are chosen for contrast against the dark
// row background without competing with the cover thumbnail.
const STATUS_DOT_CLASS = {
  reading:  'bg-sky-400',
  finished: 'bg-emerald-500',
  unread:   'bg-neutral-700',
};

// Mirror of the SORTS array in pages/Library.jsx. Kept as a local copy
// rather than imported to keep the palette decoupled from page internals
// — if Library renames a sort key, both files need updating, but the
// keys are part of the URL contract anyway so this is a stable surface.
// The `tabs` metadata is what powers per-tab sort filtering in the palette:
// 'custom' only makes sense on the Never owned tab (manual rank).
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
  { key: 'length',      label: 'Length' },
  { key: 'custom',      label: 'Custom order', tabs: ['never_owned'] },
  { key: 'random',      label: 'Random' },
];

// Mirror of Library's VALID_TABS — used to derive the current tab from
// the URL inside libraryActions so per-tab sort filtering matches what
// Library itself accepts.
const VALID_TABS = new Set(['reading', 'finished', 'unread', 'owned', 'prev_owned', 'never_owned', 'all', 'archived']);

function sortAllowedForTab(sortKey, tab) {
  const def = SORTS.find(s => s.key === sortKey);
  if (!def) return false;
  if (def.tabs && !def.tabs.includes(tab)) return false;
  return true;
}

// Qualifiers we autocomplete values for. `title` is omitted intentionally —
// titles are per-book, there's no facet to suggest from, and a flood of
// title rows in an autocomplete picker would be more noise than signal.
// Maps each qualifier to the facet array name returned by /api/books/facets.
const QUALIFIER_FACET_KEY = {
  tag:        'tags',
  author:     'authors',
  narrator:   'narrators',
  translator: 'translators',
  series:     'series',
  publisher:  'publishers',
  list:       'lists',
};

// Identify whether the cursor is sitting inside the value portion of a
// known qualifier in the input string, and if so where the value's
// replaceable range starts and ends. Returns null for any non-qualifier
// position (bare terms, qualifier names being typed, terms after a closed
// quoted value, etc.) so callers can treat null as "no autocomplete".
//
// Returned shape: { qualifier, partial, startIdx, endIdx, quoted }
//   - qualifier: lowercased qualifier name (e.g. 'tag')
//   - partial:   the text already typed in the value position
//   - startIdx:  index in input where the value text begins (replacement target start)
//   - endIdx:    index in input where the value text ends (replacement target end)
//   - quoted:    true if the value is inside an open quoted string
//
// Examples:
//   parseCursorContext('tag:man', 7)       → { qualifier: 'tag', partial: 'man', startIdx: 4, endIdx: 7, quoted: false }
//   parseCursorContext('tag:', 4)          → { qualifier: 'tag', partial: '',    startIdx: 4, endIdx: 4, quoted: false }
//   parseCursorContext('-tag:manga', 10)   → { qualifier: 'tag', partial: 'manga', startIdx: 5, endIdx: 10, quoted: false }
//   parseCursorContext('tag:"New Sun', 12) → { qualifier: 'tag', partial: 'New Sun', startIdx: 5, endIdx: 12, quoted: true }
//   parseCursorContext('foo bar', 7)       → null
//   parseCursorContext('title:abc', 9)     → null  (title isn't in QUALIFIER_FACET_KEY)
function parseCursorContext(input, cursorPos) {
  // Walk the prefix tracking quote state and the position of the last
  // token-boundary character. Boundaries (whitespace + parens) reset the
  // token start so we can locate the qualifier:value pair the cursor is
  // currently editing. Quote state is tracked so whitespace inside a
  // quoted value doesn't end the token prematurely.
  let tokenStart  = 0;
  let quoteOpenAt = -1;
  for (let i = 0; i < cursorPos; i++) {
    const c = input[i];
    if (quoteOpenAt !== -1) {
      if (c === '"') quoteOpenAt = -1;
      continue;
    }
    if (c === '"') { quoteOpenAt = i; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '(' || c === ')') {
      tokenStart = i + 1;
    }
  }

  if (quoteOpenAt !== -1) {
    // Inside an unclosed quoted value. The qualifier prefix is the
    // characters between the token start and the opening quote.
    const prefixRaw = input.slice(tokenStart, quoteOpenAt);
    const prefix    = prefixRaw.startsWith('-') ? prefixRaw.slice(1) : prefixRaw;
    if (!prefix.endsWith(':')) return null;
    const qualifier = prefix.slice(0, -1).toLowerCase();
    if (!QUALIFIER_FACET_KEY[qualifier]) return null;
    const startIdx = quoteOpenAt + 1;
    const partial  = input.slice(startIdx, cursorPos);
    // The value ends at the next closing quote on the line if one exists,
    // so a mid-edit replace cleanly swaps the contents instead of leaving
    // a duplicate. With no closing quote yet, the range ends at the cursor.
    let endIdx = cursorPos;
    let k = cursorPos;
    while (k < input.length && input[k] !== '"') k++;
    if (k < input.length) endIdx = k;
    return { qualifier, partial, startIdx, endIdx, quoted: true };
  }

  const tokenSoFar = input.slice(tokenStart, cursorPos);
  const negOffset  = tokenSoFar.startsWith('-') ? 1 : 0;
  const body       = negOffset ? tokenSoFar.slice(1) : tokenSoFar;
  const colonIdx   = body.indexOf(':');
  if (colonIdx === -1) return null;
  const qualifier = body.slice(0, colonIdx).toLowerCase();
  if (!QUALIFIER_FACET_KEY[qualifier]) return null;
  const startIdx = tokenStart + negOffset + colonIdx + 1;
  const partial  = body.slice(colonIdx + 1);
  // Unquoted value runs to the next whitespace/paren/quote — same rule
  // the backend tokenizer uses. Colons are allowed inside the value, so
  // they don't terminate the range.
  let k = cursorPos;
  while (k < input.length && input[k] !== ' ' && input[k] !== '\t' && input[k] !== '\n' && input[k] !== '(' && input[k] !== ')' && input[k] !== '"') k++;
  return { qualifier, partial, startIdx, endIdx: k, quoted: false };
}

// Case-insensitive token-AND match — every whitespace-separated token in
// the query must appear somewhere in the text, in any order. Lets users
// drop filler words ("sort author" matches "Sort by Author A–Z") without
// pulling in a full fuzzy-search dependency. Book search stays on the
// backend FTS path for its smarter ranking.
function matchesQuery(text, q) {
  if (!q) return true;
  const haystack = text.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every(t => haystack.includes(t));
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
  if (entry.id.startsWith('suggest.')) return false;
  if (entry.kind === 'action' && entry.id.startsWith('book.')) return false;
  return true;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [bookResults, setBookResults] = useState([]);
  const [bookLoading, setBookLoading] = useState(false);
  const [authorResults, setAuthorResults] = useState([]);
  const [lists, setLists] = useState([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  // Cached facet data for qualifier-value autocomplete (tag:, author:,
  // series:, narrator:, translator:, publisher:). Fetched once on first
  // open from /api/books/facets — same endpoint FilterPanel uses, no new
  // backend surface needed. Stays in memory for the session; a long-lived
  // tab won't pick up brand-new tags/authors etc. until reload, which
  // mirrors the existing `lists` cache tradeoff and is acceptable for an
  // autocomplete affordance.
  const [facets, setFacets] = useState(null);
  const [facetsLoaded, setFacetsLoaded] = useState(false);
  // Cursor position inside the search input. Re-synced via onChange,
  // onKeyUp, onClick, onFocus — covers typing, arrow navigation, mouse
  // clicks, and focus restoration. parseCursorContext consumes this
  // alongside `query` to decide whether to surface autocomplete.
  const [cursorPos, setCursorPos] = useState(0);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // Element to refocus when the palette closes — usually the page-level
  // control the user was last on. Mirrors ConfirmModal's pattern so
  // keyboard users aren't dumped to <body>.
  const returnFocusRef = useRef(null);
  // Stale-response guard: rapid typing fires multiple in-flight searches;
  // earlier ones must not overwrite results from a later query.
  const queryGuard = useStaleGuard();
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
  // Same shape for /lists/:id — the palette already caches `lists` for
  // the navigation section, so the list's name is free to look up. Used
  // by pick() to produce an accurate from-label when navigating away.
  const listMatch = useMatch('/lists/:id');
  const currentListId = listMatch && /^\d+$/.test(listMatch.params.id)
    ? Number(listMatch.params.id)
    : null;
  const [reading, setReading] = useState([]);
  const [recent, setRecent] = useState(loadMRU);
  // Sub-prompt state. null when in root mode; otherwise { action,
  // bookId, bookTitle } describing the parameter-picker currently
  // active. Escape returns to root before closing the whole palette.
  const [subPrompt, setSubPrompt] = useState(null);
  // Mirror of Library's paging state, kept in sync via the
  // spine:library-paging event Library dispatches on mount, on state
  // change, and in response to spine:library-paging-request (which the
  // palette fires on every open). When off Library the values stay
  // stale, but `isOnLibrary` gates the rendered entries anyway.
  const [paging, setPaging] = useState({ hasMore: false, loadingMore: false, loadingAll: false, loaded: 0, total: 0 });
  // Inline error surfaced in sub-prompt mode when a pick fails. Cleared
  // automatically on input change and on sub-prompt entry/exit so it
  // doesn't sit stale after a retry.
  const [subPromptError, setSubPromptError] = useState(null);
  // Root-level action error — bubble for failures of book.toggle-* /
  // book.delete etc. Without this, pick()'s catch silently absorbed the
  // throw and the palette stayed open with no signal that the action
  // failed. Same clear semantics as subPromptError.
  const [actionError, setActionError] = useState(null);

  // Reset query / results / selection without dismissing the palette
  // — used both by close() and by sub-prompt transitions, where we
  // want a fresh input but want to stay open. Resets cursorPos too so
  // a stale value doesn't linger when the input mounts back fresh.
  const resetQuery = useCallback(() => {
    setQuery('');
    setBookResults([]);
    setBookLoading(false);
    setSelected(0);
    setCursorPos(0);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    resetQuery();
    setSubPrompt(null);
    setActionError(null);
    setSubPromptError(null);
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
  //
  // Only mark loaded on success — a transient fetch failure on first
  // open would otherwise permanently disable the Lists section (and the
  // add-to-list sub-prompt picker) for the rest of the session, since
  // the gate at the top of the effect would short-circuit subsequent
  // opens.
  useEffect(() => {
    if (!open || listsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getLists();
        if (cancelled) return;
        setLists(Array.isArray(data) ? data : []);
        setListsLoaded(true);
      } catch {
        if (!cancelled) setLists([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open, listsLoaded]);

  // Pre-fetch facets on mount (not on first open) for qualifier-value
  // autocomplete. Eager so a fast user typing `tag:` immediately on first
  // open isn't briefly thrown into the normal palette while the fetch
  // races their keystrokes. Empty params → corpus-wide facets (every
  // tag/author/etc. in the library), which is what autocomplete wants —
  // filtered facets would silently hide values that don't match the
  // current Library view's filters. Same retry-on-failure shape as the
  // lists fetch.
  useEffect(() => {
    if (facetsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getBookFacets();
        if (cancelled) return;
        setFacets(data || null);
        setFacetsLoaded(true);
      } catch {
        if (!cancelled) setFacets(null);
      }
    })();
    return () => { cancelled = true; };
  }, [facetsLoaded]);

  // Fetch the current book whenever the palette opens on /books/:id.
  // Re-fetching per open (rather than caching) keeps the loved /
  // readlist / archive labels accurate after the user mutates state
  // on the detail page itself. Clear `currentBook` synchronously
  // before the fetch — without that, navigating /books/A → /books/B
  // with the palette open leaves the bookActions perform()s targeting
  // book A's id until book B's fetch resolves.
  useEffect(() => {
    setCurrentBook(null);
    if (!open || currentBookId == null) return;
    let cancelled = false;
    api.getBook(currentBookId)
      .then(b => { if (!cancelled) setCurrentBook(b); })
      .catch(() => { if (!cancelled) setCurrentBook(null); });
    return () => { cancelled = true; };
  }, [open, currentBookId]);

  // Continue-reading: fetch once on mount, then refetch when any book
  // mutates or is deleted. Cheaper than the prior per-open fetch (which
  // hit the endpoint even when no book had moved into or out of reading
  // status between opens), and freshness is unchanged because every
  // status change goes through spine:book-mutated.
  const readingGuard = useStaleGuard();
  const refetchReading = useCallback(() => {
    const epoch = readingGuard.next();
    api.getBooks({ statuses: 'reading', sort: 'updated', limit: 3 })
      .then(d => { if (readingGuard.isFresh(epoch)) setReading(d.books || []); })
      .catch(() => { if (readingGuard.isFresh(epoch)) setReading([]); });
  }, [readingGuard]);
  useEffect(() => { refetchReading(); }, [refetchReading]);
  useSpineEvent('spine:book-mutated', refetchReading);
  useSpineEvent('spine:book-deleted', refetchReading);

  const remember = useCallback((entry) => {
    if (!entry || !isPersistableForRecent(entry)) return;
    // Strip non-serializable bits (perform fn closures); we re-bind the
    // action's perform() from the live registry when rendering Recent.
    const stripped = {
      id:     entry.id,
      kind:   entry.kind,
      label:  entry.label,
      hint:   entry.hint ?? null,
      path:   entry.path ?? null,
      cover:  entry.cover ?? null,
      // Status is captured so Recent book rows can show their dot.
      // Mildly stale: if the user finishes the book after picking it,
      // the next palette open shows the old status in Recent until
      // the book is picked again. Acceptable — better than no signal.
      status: entry.status ?? null,
      ts:     Date.now(),
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

  // Listen for book deletions from any surface (BookCard MoreMenu,
  // BookDetail, etc.) so the MRU stays in sync. Without this, only
  // deletions performed *through* the palette were pruned — anything
  // deleted elsewhere left a stale `book.${id}` entry that would 404
  // when clicked from Recent.
  useSpineEvent('spine:book-deleted', (e) => {
    const id = e.detail?.id;
    if (id == null) return;
    forget(`book.${id}`);
  });

  // Track Library's paging state so we can surface Load more / Load all
  // entries — and only when those buttons would otherwise be visible.
  useSpineEvent('spine:library-paging', (e) => {
    const d = e.detail || {};
    setPaging({
      hasMore:     !!d.hasMore,
      loadingMore: !!d.loadingMore,
      loadingAll:  !!d.loadingAll,
      loaded:      d.loaded ?? 0,
      total:       d.total  ?? 0,
    });
  });

  // Request Library's current paging state once at mount. Library's
  // mount-time publish may have fired before our listener was attached
  // (sibling-effect ordering); this request closes that gap. Subsequent
  // Library state changes propagate via the listener above, so we don't
  // need to re-request on every palette open.
  useEffect(() => {
    dispatchSpineEvent('spine:library-paging-request');
  }, []);

  // Autocomplete context derived from cursor + query + cached facets.
  // Declared above the book search effect so the effect's deps can
  // include it and skip wasted backend fetches while the user is
  // editing a qualifier value.
  const context = useMemo(() => {
    if (!facets) return null;
    return parseCursorContext(query, cursorPos);
  }, [query, cursorPos, facets]);

  // Cap controls the visible suggestion count. Past ~15 the picker
  // dominates the surface and stops feeling like an inline aid; the
  // long tail is reachable by typing more of the value. `total` is
  // exposed alongside the capped list so the section label and the
  // AT live region can be honest about the truncation rather than
  // silently saying "15 matches" when 200 actually exist.
  const SUGGESTION_CAP = 15;
  const { items: suggestions, total: suggestionsTotal } = useMemo(() => {
    if (!context) return { items: [], total: 0 };
    const key     = QUALIFIER_FACET_KEY[context.qualifier];
    const values  = facets?.[key] || [];
    const partial = context.partial.toLowerCase().trim();
    const matched = partial ? values.filter(v => matchesQuery(v, partial)) : values;
    return { items: matched.slice(0, SUGGESTION_CAP), total: matched.length };
  }, [context, facets]);

  // Insert a picked suggestion back into the query. Handles two shapes:
  // (a) quoted value the user already opened — the closing quote is
  // appended if missing, and the cursor lands past it; (b) unquoted —
  // values containing whitespace or syntax characters are auto-quoted
  // so the backend tokenizer still parses them as a single value.
  // A trailing space is inserted unless one already follows, so the
  // user can immediately type the next term without first deleting an
  // accidentally-concatenated character.
  const applyCompletion = useCallback((value) => {
    if (!context) return;
    let replacement;
    let cursorAfterClosingQuote = false;
    if (context.quoted) {
      const hasClosing = query[context.endIdx] === '"';
      replacement = hasClosing ? value : value + '"';
      cursorAfterClosingQuote = hasClosing;
    } else {
      replacement = /[\s()"]/.test(value) ? `"${value}"` : value;
    }
    let newQuery   = query.slice(0, context.startIdx) + replacement + query.slice(context.endIdx);
    let newCursor  = context.startIdx + replacement.length + (cursorAfterClosingQuote ? 1 : 0);
    const charAfter = newQuery[newCursor];
    if (charAfter == null || (charAfter !== ' ' && charAfter !== '\t' && charAfter !== '\n')) {
      newQuery  = newQuery.slice(0, newCursor) + ' ' + newQuery.slice(newCursor);
      newCursor = newCursor + 1;
    }
    // setCursorPos is synchronous with setQuery so the next render sees
    // both new values together — otherwise the parser runs for one frame
    // with the new query and the old cursor position, briefly showing
    // wrong suggestions before settling. setSelectionRange still has to
    // happen in an rAF so it runs AFTER React commits the new value to
    // the DOM (otherwise the controlled-input re-render would snap the
    // cursor back to the end of the new string).
    setQuery(newQuery);
    setCursorPos(newCursor);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(newCursor, newCursor);
      }
    });
  }, [context, query]);

  // Debounced book + author search. Empty query → no results (we still
  // show the nav directory; books / authors wait for a real query because
  // they're round-trips). Books run even when autocomplete is active so
  // books matching the current qualifier (e.g. `tag:manga`) sit alongside
  // the value suggestions — the backend already parses qualifier syntax.
  // Authors skip the autocomplete branch: the user has committed to a
  // qualifier-value pick, not a direct jump to an author page. Both
  // fetches share one debounce window and a single stale-response guard,
  // since the query that triggers them is the same.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setBookResults([]);
      setAuthorResults([]);
      setBookLoading(false);
      return;
    }
    setBookLoading(true);
    const epoch = queryGuard.next();
    const skipAuthors = !!context;
    const t = setTimeout(async () => {
      const [booksRes, authorsRes] = await Promise.allSettled([
        api.getBooks({ q, limit: 20 }),
        skipAuthors ? Promise.resolve([]) : api.getAuthors({ q }),
      ]);
      if (!queryGuard.isFresh(epoch)) return;
      setBookResults(booksRes.status === 'fulfilled' ? (booksRes.value.books || []) : []);
      setAuthorResults(authorsRes.status === 'fulfilled' ? (Array.isArray(authorsRes.value) ? authorsRes.value : []) : []);
      setBookLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [query, open, context]);

  // Clear any stale sub-prompt / action error when the user keeps typing
  // or when the sub-prompt itself toggles. Prevents a "failed" message
  // from sitting next to an unrelated filter the user has narrowed to.
  useEffect(() => {
    setSubPromptError(null);
    setActionError(null);
  }, [query, subPrompt]);

  // Library actions are URL-driven and only meaningful when the user is
  // on Library — there's no "current tab" to sort or "current filters"
  // to clear off-page. Returning an empty list off Library both hides
  // the entries from the typed-query Actions section AND filters them
  // out of Recent (the resolver drops MRU entries with no live match).
  //
  // Sort entries are filtered to those allowed for the current tab —
  // Custom order, for instance, is only meaningful on Never owned, so
  // it would silently coerce to 'updated' if surfaced elsewhere.
  const libraryActions = useMemo(() => {
    if (!isOnLibrary) return [];
    const currentParams = searchParams;
    const urlTab = currentParams.get('tab');
    const currentTab = (urlTab && VALID_TABS.has(urlTab)) ? urlTab : 'reading';

    const changeSort = (key) => () => {
      const next = new URLSearchParams(currentParams);
      next.set('sort', key);
      setSearchParams(next, { state: location.state });
    };

    // Strip everything paramsToFilters / the search field reads, but
    // preserve view state (tab, sort). The label says "filters and
    // search" — tab and sort aren't filters, and silently switching the
    // user off their current tab is the same shape of bug as the
    // 'nav.library' entry that used to land on Reading instead of All.
    const FILTER_PARAM_KEYS = [
      'q',
      'missing', 'formats', 'ratings', 'publishers', 'sources', 'series', 'tags', 'statuses',
      'tagsMode',
      'owned', 'previouslyOwned', 'custom', 'loved',
    ];
    const clearAll = () => {
      const next = new URLSearchParams(currentParams);
      for (const k of FILTER_PARAM_KEYS) next.delete(k);
      setSearchParams(next, { state: location.state });
    };

    // Load more / Load all mirror Library's two paging buttons — only
    // surfaced when those buttons would themselves be visible (hasMore)
    // and not already in flight. Picking either dispatches an event
    // Library listens for and runs the existing handler.
    const pagingEntries = [];
    if (paging.hasMore && !paging.loadingMore && !paging.loadingAll) {
      const remaining = Math.max(0, paging.total - paging.loaded);
      pagingEntries.push({
        id: 'action.load-more',
        kind: 'action',
        label: remaining > 0 ? `Load more · ${remaining} remaining` : 'Load more',
        hint: 'Library',
        perform: () => dispatchSpineEvent('spine:library-load-more'),
      });
      pagingEntries.push({
        id: 'action.load-all',
        kind: 'action',
        label: 'Load all',
        hint: 'Library',
        perform: () => dispatchSpineEvent('spine:library-load-all'),
      });
    }

    return [
      {
        id: 'action.clear',
        kind: 'action',
        label: 'Clear filters and search',
        hint: 'Library',
        perform: clearAll,
      },
      ...pagingEntries,
      ...SORTS.filter(s => sortAllowedForTab(s.key, currentTab)).map(s => ({
        id: `action.sort.${s.key}`,
        kind: 'action',
        label: `Sort by ${s.label}`,
        hint: 'Library',
        perform: changeSort(s.key),
      })),
    ];
  }, [isOnLibrary, searchParams, setSearchParams, paging, location.state]);

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
    const fireMutation = () => dispatchSpineEvent('spine:book-mutated', { id });
    // Wrap a perform body in try/catch: on failure, surface an inline
    // error and re-throw so pick()'s catch keeps the palette open
    // instead of silently closing. Matches the contract in pick()'s
    // comment ("perform sets the visible error state and re-throws").
    const guarded = (label, fn) => async () => {
      try { await fn(); } catch {
        setActionError(`Failed to ${label}.`);
        throw new Error('palette-stay');
      }
    };

    return [
      {
        id: 'book.toggle-loved',
        kind: 'action',
        label: currentBook.loved ? 'Remove from loved' : 'Mark as loved',
        hint: title,
        perform: guarded(currentBook.loved ? 'remove from loved' : 'mark as loved', async () => {
          await api.patchBook(id, { loved: !currentBook.loved });
          fireMutation();
        }),
      },
      {
        id: 'book.toggle-readlist',
        kind: 'action',
        label: currentBook.on_readlist ? 'Remove from readlist' : 'Add to readlist',
        hint: title,
        perform: guarded(currentBook.on_readlist ? 'remove from readlist' : 'add to readlist', async () => {
          await api.patchBook(id, { on_readlist: !currentBook.on_readlist });
          fireMutation();
        }),
      },
      {
        id: 'book.toggle-archive',
        kind: 'action',
        label: currentBook.archived ? 'Restore from archive' : 'Archive book',
        hint: title,
        perform: guarded(currentBook.archived ? 'restore from archive' : 'archive book', async () => {
          await api.patchBook(id, { archived: !currentBook.archived });
          fireMutation();
        }),
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
          // User cancelled the confirm — throw so pick()'s catch keeps
          // the palette open. Without this, "Delete book…" → "No" still
          // dismissed the palette via pick's fall-through.
          if (!ok) throw new Error('palette-stay');
          await guarded('delete book', async () => {
            await api.deleteBook(id);
            forget(`book.${id}`);
            // Tell other live surfaces (Library card grid, etc.) that
            // this book is gone so they can drop it from their visible
            // lists without a refetch. Same event the BookCard MoreMenu
            // dispatches after its delete.
            dispatchSpineEvent('spine:book-deleted', { id });
            navigate('/');
          })();
        },
      },
    ];
  }, [currentBook, navigate, confirm, resetQuery, forget]);

  // Random-book action — palette parallel of the `R` keyboard shortcut.
  // Forwards the current Library search params when on /, so a palette
  // "Random book" pick from /?tab=reading lands on a random reading
  // book just like R does. Mirrors App.jsx's chain-preservation rule:
  // when invoked from /books/X, inherit the incoming back-link state
  // so the chain returns to the original referrer rather than the
  // previous random pick.
  const randomBookEntries = useMemo(() => [{
    id: 'action.random_book',
    kind: 'action',
    label: 'Random book',
    hint: 'Surprise me',
    perform: async () => {
      const search = location.pathname === '/' ? location.search : '';
      let fromPath, from;
      if (location.pathname.startsWith('/books/')) {
        fromPath = location.state?.fromPath ?? '/';
        from     = location.state?.from     ?? 'Library';
      } else {
        fromPath = location.pathname + location.search;
        from     = labelForPath(location.pathname);
      }
      try {
        const { id } = await api.getRandomBook(search);
        navigate(`/books/${id}`, { state: { from, fromPath } });
      } catch {
        // Empty-pool 404 etc. — silent; palette closes either way.
      }
    },
  }], [navigate, location.pathname, location.search, location.state]);

  const actionEntries = useMemo(
    () => [...bookActions, ...libraryActions, ...randomBookEntries],
    [bookActions, libraryActions, randomBookEntries],
  );

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
      id:     `book.${b.id}`,
      kind:   'book',
      label:  b.title,
      hint:   b.authors?.map(a => a.name).join(', ') || null,
      cover:  b.cover_path,
      status: b.status,
      archived: b.archived,
      path:   `/books/${b.id}`,
    })), [reading, currentBookId]);

  const recentEntries = useMemo(() => {
    const continueIds   = new Set(continueEntries.map(e => e.id));
    const currentBookEntryId = currentBookId != null ? `book.${currentBookId}` : null;
    return recent
      .map(r => {
        if (r.kind === 'action') {
          const live = actionEntries.find(a => a.id === r.id);
          return live || null;
        }
        // Nav entries are also rebound from the live registry so path /
        // label changes (e.g. nav.library swapping `/` → `/?tab=all`)
        // take effect on stored MRU entries instead of dispatching the
        // user to a stale URL. Nav entries that have since been removed
        // drop from Recent. Book and list entries stay self-described —
        // their target is the resource id, not a code-side definition.
        if (r.kind === 'nav') {
          const live = NAV_ENTRIES.find(n => n.id === r.id);
          return live ? { ...live, kind: 'nav' } : null;
        }
        return r;
      })
      .filter(Boolean)
      // Drop the currently-viewed book — Continue reading already does
      // this; Recent should too, otherwise the palette suggests reloading
      // the page the user is already on. Continue's dedup doesn't catch
      // it because Continue filtered the book out before forming its set.
      .filter(e => e.id !== currentBookEntryId)
      .filter(e => !continueIds.has(e.id))
      .slice(0, 3);
  }, [recent, actionEntries, continueEntries, currentBookId]);

  // Build the sectioned result set. Memoized so arrow-key navigation
  // doesn't recompute on every render. Three modes:
  //   1. Sub-prompt mode: show the parameter picker only (lists for
  //      'add-to-list'). Other sections are suppressed so the user
  //      stays focused on the choice they're making.
  //   2. Empty root: pre-curated discovery (Continue reading, Recent,
  //      Book actions, the static directory).
  //   3. Query root: everything filtered by the input.
  //   4. Autocomplete: the cursor is sitting inside a qualifier value
  //      (tag:|, author:foo, etc.). The Suggestions section replaces
  //      everything else, even when no values match (shows "No matches"
  //      via the normal empty-state message rather than falling through
  //      to the regular palette and surprising the user).
  //
  // parseCursorContext returns null whenever there's nothing to
  // autocomplete, so the autocomplete branch silently steps aside as
  // soon as the user moves the cursor out of a qualifier value.

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
          hint: l.book_count != null ? plural(l.book_count, 'book') : null,
          perform: async () => {
            setSubPromptError(null);
            try {
              await api.addToList(l.id, subPrompt.bookId);
              dispatchSpineEvent('spine:book-mutated', { id: subPrompt.bookId });
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
    } else if (context) {
      // Autocomplete mode — Suggestions section sits above any Books
      // matched by the current qualifier query. Both stay active even
      // when no values match: each section drops out via the
      // entries.length filter below, and the existing empty-state "No
      // matches." message surfaces — better than silently falling back
      // to the regular palette and giving the user no signal that their
      // qualifier matched nothing.
      const truncated = suggestionsTotal > suggestions.length;
      const bookEntries = bookResults.map(b => ({
        id:     `book.${b.id}`,
        kind:   'book',
        label:  b.title,
        hint:   b.authors?.map(a => a.name).join(', ') || null,
        cover:  b.cover_path,
        status: b.status,
        path:   `/books/${b.id}`,
      }));
      _sections = [
        {
          kind: 'suggest',
          label: truncated
            ? `${context.qualifier}: showing ${suggestions.length} of ${suggestionsTotal} — keep typing to narrow`
            : `${context.qualifier}: matches`,
          entries: suggestions.map(v => ({
            id:       `suggest.${context.qualifier}.${v}`,
            kind:     'suggest',
            label:    v,
            keepOpen: true,
            perform:  () => applyCompletion(v),
          })),
        },
        { kind: 'book', label: 'Books', entries: bookEntries },
      ];
    } else if (isEmpty) {
      // Pre-curated empty state. The full Library action set is suppressed
      // here — it'd add 10 similar-looking 'Sort by ...' rows and dominate
      // the surface. Paging entries (Load more / Load all) are the
      // exception: they're contextual to the current view (only present
      // when there's more to load), capped at two, and the obvious thing
      // to reach for on a partially-loaded Library. Book actions stay
      // visible when on a detail page for the same reason.
      const listEntries = lists.map(l => ({
        id: `list.${l.id}`,
        kind: 'list',
        label: l.name,
        hint: l.book_count != null ? plural(l.book_count, 'book') : null,
        path: `/lists/${l.id}`,
      }));
      const pagingEmptyEntries = libraryActions.filter(a => a.id === 'action.load-more' || a.id === 'action.load-all');

      _sections = [
        { kind: 'continue', label: 'Continue reading', entries: continueEntries },
        { kind: 'recent',   label: 'Recent',           entries: recentEntries },
        { kind: 'action',   label: 'Book actions',     entries: bookActions },
        { kind: 'library',  label: 'Library',          entries: pagingEmptyEntries },
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
          hint: l.book_count != null ? plural(l.book_count, 'book') : null,
          path: `/lists/${l.id}`,
        }));

      const bookEntries = bookResults.map(b => ({
        id:     `book.${b.id}`,
        kind:   'book',
        label:  b.title,
        hint:   b.authors?.map(a => a.name).join(', ') || null,
        cover:  b.cover_path,
        status: b.status,
        path:   `/books/${b.id}`,
      }));

      // Author direct-jump entries — typing "tolkien" gives the user a
      // one-click route to /authors/:id instead of having to pick a book
      // and then click the byline. Placed above Books because that intent
      // wins for queries that are clearly a name.
      const authorEntries = authorResults.map(a => ({
        id:    `author.${a.id}`,
        kind:  'author',
        label: a.name,
        hint:  a.book_count != null ? plural(a.book_count, 'book') : null,
        path:  `/authors/${a.id}`,
      }));

      _sections = [
        { kind: 'nav',    label: 'Navigate', entries: navEntries },
        { kind: 'action', label: 'Actions',  entries: matchedActions },
        { kind: 'list',   label: 'Lists',    entries: listEntries },
        { kind: 'author', label: 'Authors',  entries: authorEntries },
        { kind: 'book',   label: 'Books',    entries: bookEntries },
      ];
    }

    _sections = _sections.filter(s => s.entries.length > 0);
    return { sections: _sections, flat: _sections.flatMap(s => s.entries) };
  }, [query, lists, bookResults, authorResults, actionEntries, bookActions, continueEntries, recentEntries, subPrompt, context, suggestions, suggestionsTotal, applyCompletion, libraryActions]);

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
    if (entry.path) {
      // Pass the user's current location so the destination's back link
      // returns to the exact view they were on — including any active
      // Library tab — instead of falling back to document.referrer
      // (which inside an SPA only updates on hard navigations and is
      // routinely stale).
      // On entity-specific paths (/books/:id, /lists/:id) prefer the
      // entity's name over labelForPath, which only knows about index
      // routes and would otherwise produce a "← Library" / "← Lists"
      // label pointing at the specific entity URL — label and path
      // disagreeing. /lists is free because the palette already caches
      // every list's name; /authors/:id is skipped because it would
      // require an extra fetch for a narrow win.
      const onBookDetail = currentBookId != null;
      const currentListName = currentListId != null
        ? lists.find(l => l.id === currentListId)?.name
        : null;
      const fromLabel = onBookDetail
        ? (currentBook?.title ?? 'Book')
        : currentListName
        ? currentListName
        : labelForPath(location.pathname);
      navigate(entry.path, {
        state: {
          from: fromLabel,
          fromPath: location.pathname + location.search,
        },
      });
    }
  }

  // Ctrl/Cmd+Enter on a path-based entry opens it in a new browser tab
  // while keeping the palette open at the user's current query and
  // selection. Lets the user fan out into multiple tabs from one search
  // without losing their place. Only path entries support this — action
  // entries (perform-only) and sub-prompt picks aren't navigation, so
  // 'open in new tab' isn't meaningful for them.
  function openInNewTab(entry) {
    if (!entry || !entry.path) return;
    remember(entry);
    window.open(entry.path, '_blank', 'noopener,noreferrer');
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
      const entry = flat[selected];
      if (e.ctrlKey || e.metaKey) {
        openInNewTab(entry);
      } else {
        pick(entry);
      }
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
            <span className="truncate" title={subPrompt.bookTitle}>{subPrompt.bookTitle}</span>
            <span className="ml-auto text-neutral-700">esc to cancel</span>
          </div>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursorPos(e.target.selectionStart ?? 0); }}
          onKeyUp={(e) => setCursorPos(e.target.selectionStart ?? 0)}
          onClick={(e) => setCursorPos(e.target.selectionStart ?? 0)}
          onFocus={(e) => setCursorPos(e.target.selectionStart ?? 0)}
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
        {!subPrompt && actionError && (
          <p role="alert" className="px-4 py-2 text-xs text-warn border-b border-neutral-800">
            {actionError}
          </p>
        )}
        {/* Live region announcing autocomplete match counts. role="status"
            implies aria-live="polite" so screen readers wait for a natural
            pause before reading. Empty when not autocompleting, so it
            stays silent during normal palette use. Suppressed in sub-
            prompt mode — autocomplete isn't visible there (the sub-prompt
            section takes precedence in the render), so announcing it
            would mislead AT users about what's on screen. */}
        <p role="status" className="sr-only">
          {context && !subPrompt
            ? (suggestions.length > 0
                ? (suggestionsTotal > suggestions.length
                    ? `Showing ${suggestions.length} of ${suggestionsTotal} ${context.qualifier} matches`
                    : `${suggestions.length} ${context.qualifier} ${pluralWord(suggestions.length, 'match', 'matches')}`)
                : `No ${context.qualifier} matches`)
            : ''}
        </p>
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
                    // Mirror BookCard's archived dimming so the cue reads
                    // the same on every surface where a book is listed.
                    const archivedDim = entry.kind === 'book' && entry.archived ? 'opacity-60 saturate-50' : '';
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          data-row-index={idx}
                          onClick={(e) => {
                            // Ctrl/Cmd+Click mirrors Ctrl+Enter — open
                            // the entry's target in a new tab while
                            // leaving the palette open. Only meaningful
                            // for path-based entries; openInNewTab is a
                            // no-op for action / perform-only rows.
                            if ((e.ctrlKey || e.metaKey) && entry.path) {
                              openInNewTab(entry);
                            } else {
                              pick(entry);
                            }
                          }}
                          onMouseEnter={() => setSelected(idx)}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                            isSelected ? 'bg-neutral-800' : 'hover:bg-neutral-800/60'
                          } ${archivedDim}`}
                        >
                          {entry.kind === 'book' ? (
                            entry.cover ? (
                              <img src={entry.cover} alt="" className="w-8 h-12 object-cover rounded flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-12 bg-gradient-to-br from-neutral-700 to-neutral-900 rounded flex-shrink-0 flex items-center justify-center text-[10px] text-neutral-500 font-medium tracking-wide">{initialsFor(entry.label)}</div>
                            )
                          ) : (
                            <div className="w-6 flex-shrink-0 text-neutral-600 text-xs">
                              {entry.kind === 'nav'     ? '→'
                                : entry.kind === 'action'  ? '⚡'
                                : entry.kind === 'suggest' ? ':'
                                : entry.kind === 'author'  ? '✎'
                                : '☰'}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white truncate" title={entry.label}>
                              {entry.kind === 'book' && entry.status && STATUS_DOT_CLASS[entry.status] && (
                                <>
                                  <span
                                    aria-hidden="true"
                                    className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${STATUS_DOT_CLASS[entry.status]}`}
                                  />
                                  <span className="sr-only">Status: {entry.status}. </span>
                                </>
                              )}
                              {entry.label}
                            </p>
                            {entry.hint && (
                              <p className="text-xs text-neutral-500 truncate" title={entry.hint}>{entry.hint}</p>
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
          <span>{subPrompt ? '↑↓ navigate · ↵ select · esc back' : `↑↓ navigate · ↵ open · ${MOD_KEY}+↵ new tab · esc close`}</span>
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
