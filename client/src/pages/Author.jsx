import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { api } from '../api.js';
import { plural, initialsFor, MOD_KEY, formatPartialDate, FORMAT_LABEL } from '../utils.js';
import BookCard from '../components/BookCard.jsx';
import { GridSkeleton } from '../components/Skeleton.jsx';
import { useTextOverflow } from '../hooks/useTextOverflow.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dispatchSpineEvent } from '../hooks/useSpineEvent.js';

// Inline gender picker. Stores 'male' | 'female' | 'other' | null;
// empty string in the select maps back to null so the user can clear
// the field. Styled to blend into the surrounding meta line — native
// chevron suppressed, padding stripped, underline-on-hover signals
// it's interactive without screaming "form control".
// Native <select> sizes itself to its widest option ("unassigned" here),
// which leaves an awkward gap to the right of shorter values. Workaround:
// render a span that auto-sizes to the current value and overlay a
// transparent <select> on top to keep the native dropdown's keyboard
// support and accessibility. Hover/focus styles cascade via `group`.
function GenderPicker({ value, onChange }) {
  const display = value ?? 'unassigned';
  return (
    <span className="relative inline-block group cursor-pointer">
      <span className="text-sm text-neutral-700 underline decoration-dotted decoration-neutral-800 underline-offset-2 group-hover:text-neutral-400 group-hover:decoration-solid group-hover:decoration-neutral-500 group-focus-within:text-neutral-400 group-focus-within:decoration-solid group-focus-within:decoration-neutral-500 transition-colors">
        {display}
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer focus:outline-none"
        aria-label="Author gender"
      >
        <option value="">unassigned</option>
        <option value="male">male</option>
        <option value="female">female</option>
        <option value="other">other</option>
      </select>
    </span>
  );
}

// "July 18, 1938 – 2007" / "1938 –" (living author) / "– 2007" / null.
// formatPartialDate handles YYYY / YYYY-MM / YYYY-MM-DD + BCE; en-US
// month-day-year order is canonical across the app.
function lifespan(birth, death) {
  const b = formatPartialDate(birth);
  const d = formatPartialDate(death);
  if (!b && !d) return null;
  if (b && d)   return `${b} – ${d}`;
  if (b)        return `${b} –`;
  return `– ${d}`;
}

// Mirrors the server's parseDateField regex — used to flag malformed
// input before we hit the API.
const DATE_INPUT_RE = /^-?\d{1,4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;

// Auto-insert dashes as the user types digits, so "19380718" becomes
// "1938-07-18" on the fly. Strips any non-digit characters and re-
// formats based on digit count: ≤4 → YYYY, 5-6 → YYYY-MM, 7+ → YYYY-MM-DD.
// BCE years (leading '-') are passed through untouched — the digit
// count is ambiguous when a sign and explicit separator are in play,
// so user types those manually.
function autoFormatDate(raw) {
  if (!raw) return '';
  if (raw.startsWith('-')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return digits.slice(0, 4) + '-' + digits.slice(4);
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
}

// Inline editor for birth/death date. Default state shows the formatted
// dates (or a dim "add dates" hint if both null) as a hover-revealed
// link; clicking swaps in two text inputs that accept YYYY, YYYY-MM,
// or YYYY-MM-DD (BCE: "-428"). Enter commits, Esc cancels. Same hover-
// reveal aesthetic as GenderPicker so the dates feel like ambient
// metadata rather than a form control.
function DatesPicker({ birth, death, onChange }) {
  const [editing, setEditing] = useState(false);
  const [birthDraft, setBirthDraft] = useState('');
  const [deathDraft, setDeathDraft] = useState('');
  const [error, setError] = useState(null);
  function start() {
    setBirthDraft(birth ?? '');
    setDeathDraft(death ?? '');
    setError(null);
    setEditing(true);
  }
  function commit() {
    setError(null);
    const b = birthDraft.trim();
    const d = deathDraft.trim();
    if (b !== '' && !DATE_INPUT_RE.test(b)) return setError('Use YYYY, YYYY-MM, or YYYY-MM-DD');
    if (d !== '' && !DATE_INPUT_RE.test(d)) return setError('Use YYYY, YYYY-MM, or YYYY-MM-DD');
    onChange({
      birth_date: b === '' ? null : b,
      death_date: d === '' ? null : d,
    });
    setEditing(false);
  }
  function cancel() { setEditing(false); setError(null); }
  function onKey(e) {
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
  }
  if (editing) {
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <input
          type="text" value={birthDraft} onChange={(e) => setBirthDraft(autoFormatDate(e.target.value))}
          onKeyDown={onKey} autoFocus aria-label="Birth date"
          placeholder="1938-07-18"
          className="w-28 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-sm text-neutral-200 placeholder-neutral-700 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20"
        />
        <span className="text-neutral-700">–</span>
        <input
          type="text" value={deathDraft} onChange={(e) => setDeathDraft(autoFormatDate(e.target.value))}
          onKeyDown={onKey} aria-label="Death date"
          placeholder="2007"
          className="w-28 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-sm text-neutral-200 placeholder-neutral-700 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20"
        />
        <button type="button" onClick={commit} className="text-xs text-oak hover:text-leather transition-colors">Save</button>
        <button type="button" onClick={cancel}  className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">Cancel</button>
        {error && <span role="alert" className="text-xs text-warn ml-1">{error}</span>}
      </span>
    );
  }
  const text = lifespan(birth, death);
  return (
    <button
      type="button"
      onClick={start}
      className="text-sm text-neutral-700 underline decoration-dotted decoration-neutral-800 underline-offset-2 hover:text-neutral-400 hover:decoration-solid hover:decoration-neutral-500 focus:text-neutral-400 focus:decoration-solid focus:decoration-neutral-500 focus:outline-none transition-colors"
    >
      {text ?? 'add dates'}
    </button>
  );
}

// Merge-a-duplicate control. Quiet text button (same register as the
// OL refresh) that unfolds into a search picker over the author corpus
// (GET /authors?q=), then a confirm step spelling out the direction:
// the picked author's credits move HERE and their row is deleted, the
// current page's author survives. For ingest duplicates — deliberate
// pen names should use alias-link semantics instead, which this panel
// notes. Keyed on author id by the caller so all state resets when
// navigating between authors.
function MergeControl({ author, onMerged }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Debounced candidate search. The endpoint caps at 20 rows; filter
  // out the survivor itself so it can't be picked as its own loser.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setCandidates([]); return; }
    const timer = setTimeout(async () => {
      try {
        const rows = await api.getAuthors({ q });
        setCandidates(rows.filter(r => r.id !== author.id));
      } catch {
        setCandidates([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, author.id]);

  async function confirmMerge() {
    if (busy || !target) return;
    setBusy(true);
    setError(null);
    try {
      await api.mergeAuthor(author.id, target.id);
      setOpen(false);
      setQuery('');
      setTarget(null);
      onMerged();
    } catch (err) {
      setError(err?.message || 'Merge failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        className="text-[11px] text-neutral-700 hover:text-neutral-400 transition-colors"
        title="Merge a duplicate author record into this one"
      >
        ⇆ Merge a duplicate into this author
      </button>
    );
  }

  return (
    <div className="mt-1 max-w-md rounded border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
      {target ? (
        <>
          <p className="text-xs text-neutral-300">
            Merge <span className="text-parchment">{target.name}</span> into{' '}
            <span className="text-parchment">{author.name}</span>?
          </p>
          <p className="text-[11px] text-neutral-500">
            Moves {plural(target.book_count, 'book')}{target.story_count > 0 ? ` and ${plural(target.story_count, 'story', 'stories')}` : ''} here;{' '}
            <span className="text-neutral-400">{target.name}</span> is deleted. Blank fields fill from the deleted record.
            For deliberate pen names, use an alias link instead.
          </p>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={confirmMerge}
              disabled={busy}
              className="text-warn hover:text-red-300 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {busy ? 'Merging…' : 'Merge'}
            </button>
            <button
              type="button"
              onClick={() => { setTarget(null); setError(null); }}
              disabled={busy}
              className="text-neutral-600 hover:text-neutral-300 transition-colors"
            >
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); setError(null); } }}
              autoFocus
              placeholder="Search for the duplicate author…"
              aria-label="Search for the duplicate author to merge"
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20"
            />
            <button
              type="button"
              onClick={() => { setOpen(false); setQuery(''); setError(null); }}
              className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
            >
              Cancel
            </button>
          </div>
          {candidates.length > 0 && (
            <ul className="max-h-48 overflow-y-auto divide-y divide-neutral-800/60">
              {candidates.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { setTarget(c); setError(null); }}
                    className="w-full text-left px-1 py-1.5 text-xs text-neutral-300 hover:text-parchment hover:bg-neutral-800/40 rounded transition-colors"
                  >
                    {c.name}
                    <span className="text-neutral-600"> · {plural(c.book_count, 'book')}{c.story_count > 0 ? ` · ${plural(c.story_count, 'story', 'stories')}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && candidates.length === 0 && (
            <p className="text-[11px] text-neutral-600">No other authors match.</p>
          )}
        </>
      )}
      {error && <p role="alert" className="text-[11px] text-warn">{error}</p>}
    </div>
  );
}

// Author entity page: lists all books bylined under this specific
// author plus an "also writes as" section linking to alias siblings.
// Distinct from /browse/author/:name which is a name-based filter view —
// the entity page is id-based (stable across renames) and surfaces the
// aliases that the filter view can't.
export default function Author() {
  const { id }       = useParams();
  const { state, pathname } = useLocation();
  const backLabel    = state?.from ? `← ${state.from}` : '← Library';
  const backPath     = state?.fromPath ?? '/';

  const [sort, setSort] = useState('year_published');
  // Per-author sort memory parity with the per-list one. After the first
  // GET of an author, if the server-stored default_sort differs from our
  // current sort state, adopt it (setSort triggers refetch). The ref
  // distinguishes that one-time adoption from user-driven changes via
  // the dropdown, and resets on id change so each author visit re-syncs.
  const userChangedSortRef = useRef(false);
  useEffect(() => { userChangedSortRef.current = false; }, [id]);

  // Fetch the author. queryKey includes sort so a sort change is
  // treated as real navigation (new cache entry, skeleton flash);
  // returning to a previously-fetched (id, sort) via nav or back
  // button re-uses the cache with no fetch. No placeholderData: on
  // key change we want the skeleton to flash, not the previous
  // author's data to bleed through.
  const queryClient = useQueryClient();
  const authorQ = useQuery({
    queryKey: ['author', id, sort],
    queryFn:  () => api.getAuthor(id, { sort }),
  });
  const rawAuthor    = authorQ.data;
  const fetchLoading = authorQ.isPending;
  const fetchError   = authorQ.error;
  // No fallback on prev: setAuthor is only called after the query
  // has resolved (all sites gate on `author` being non-null).
  const setAuthor = (updater) => {
    queryClient.setQueryData(
      ['author', id, sort],
      (prev) => (typeof updater === 'function' ? updater(prev) : updater),
    );
  };

  // Server-stored default_sort adoption — if the author has a saved
  // preference and the user hasn't explicitly chosen during this visit,
  // switch sort to match. setSort changes the hook's deps → second fetch
  // with the canonical sort. Hiding `rawAuthor` until adoption resolves
  // keeps the old-sort response from briefly painting with the new sort
  // label (the flash the original fetch effect's `adopted` flag guarded).
  const adopting = !!(
    rawAuthor?.default_sort &&
    rawAuthor.default_sort !== sort &&
    !userChangedSortRef.current
  );
  useEffect(() => {
    if (adopting) setSort(rawAuthor.default_sort);
  }, [adopting, rawAuthor?.default_sort]);
  const author = adopting ? null : rawAuthor;
  const loading = fetchLoading || adopting;

  // 'notfound' for a 404 (author id has no row), 'fetch' for any other
  // failure. Distinguished so the body can show a tailored message
  // instead of conflating "this author doesn't exist" with "the request
  // failed — please retry".
  const errorKind = fetchError
    ? (fetchError.status === 404 ? 'notfound' : 'fetch')
    : null;

  // Self-heal stale references — palette MRU / Recent / future surfaces
  // caching author ids can prune themselves when the user actually hits
  // a dead entry. Fires for any 404 path: cascade prune from a last-book
  // delete, direct API delete, anything.
  useEffect(() => {
    if (fetchError?.status === 404) {
      dispatchSpineEvent('spine:author-deleted', { id: Number(id) });
    }
  }, [fetchError, id]);

  const [bioExpanded, setBioExpanded] = useState(false);
  // Measured overflow replaces the previous `author.bio.length > 280`
  // proxy — the character count couldn't tell a wide-typeset short bio
  // from a narrow-typeset long one, so the Show-more button sometimes
  // appeared on bios that fit and missed bios that didn't.
  const [bioRef, bioOverflows] = useTextOverflow(!bioExpanded, [author?.bio]);
  const [bioEditing, setBioEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [bioSaving, setBioSaving] = useState(false);
  const [bioError, setBioError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  // Synchronous re-entry guard alongside the render state. The document
  // paste listener captures photoBusy in a closure that only refreshes on
  // author change, so a second paste during an in-flight upload would read
  // a stale false and fire a duplicate upload. Mirrors BookDetail's
  // coverBusyRef.
  const photoBusyRef = useRef(false);
  // Loved toggle — single boolean, optimistic flip with rollback on
  // failure. Matches the books-side toggle on BookDetail.
  const [loveBusy, setLoveBusy] = useState(false);
  const [loveError, setLoveError] = useState(null);
  // Archived books default-hide. Toggle shows them inline when the user
  // wants to see the full bibliography. Reset on author change so a
  // toggle stuck on for Author A doesn't carry over to Author B.
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => { setShowArchived(false); }, [id]);
  // Unowned (wishlist / reference) books default-hide on the author page
  // so the bibliography reads as "what I have by this author." Persisted
  // to localStorage so the preference carries across author + browse
  // surfaces — sharing the same key as BrowsePage's toggle.
  const [showUnowned, setShowUnowned] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('spine-show-unowned') === 'true',
  );
  useEffect(() => {
    localStorage.setItem('spine-show-unowned', showUnowned ? 'true' : 'false');
  }, [showUnowned]);
  // Format chip — single-value, local state (no URL param). Matches the
  // sibling showUnowned / showArchived toggles in scope: per-visit, no
  // history-restore needed (the author entity is the URL state). Reset
  // on author change so a stuck filter doesn't carry between authors.
  const [formatFilter, setFormatFilter] = useState(null);
  useEffect(() => { setFormatFilter(null); }, [id]);
  const fileInputRef = useRef(null);

  // Reset bio collapse + edit state (and the photo/love action errors)
  // when navigating to a different author — otherwise we'd carry the
  // previous author's expanded state or a stale failure banner into a
  // new visit.
  useEffect(() => {
    setBioExpanded(false);
    setBioEditing(false);
    setBioError(null);
    setPhotoError(null);
    setLoveError(null);
    setRefreshError(null);
  }, [id]);

  function startBioEdit() {
    setBioDraft(author?.bio ?? '');
    setBioError(null);
    setBioEditing(true);
  }

  async function toggleLoved() {
    if (loveBusy) return;
    setLoveBusy(true);
    setLoveError(null);
    const prev = !!author.loved;
    const next = !prev;
    setAuthor(a => ({ ...a, loved: next ? 1 : 0 }));
    try {
      await api.updateAuthor(author.id, { loved: next });
    } catch {
      setLoveError('Failed to update loved.');
      setAuthor(a => ({ ...a, loved: prev ? 1 : 0 }));
    } finally {
      setLoveBusy(false);
    }
  }

  async function saveBio() {
    if (bioSaving) return;
    setBioSaving(true);
    setBioError(null);
    try {
      const updated = await api.updateAuthor(author.id, { bio: bioDraft });
      setAuthor(a => a ? { ...a, ...updated } : a);
      setBioEditing(false);
    } catch {
      setBioError('Failed to save bio.');
    } finally {
      setBioSaving(false);
    }
  }

  async function handleManualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const updated = await api.refreshAuthor(author.id);
      setAuthor(a => a ? { ...a, ...updated } : a);
    } catch {
      setRefreshError('Open Library refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  async function uploadPhoto(file) {
    if (photoBusyRef.current || !author || !file) return;
    if (!file.type?.startsWith('image/')) {
      setPhotoError('That doesn’t look like an image.');
      return;
    }
    photoBusyRef.current = true;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const updated = await api.uploadAuthorPhoto(author.id, file);
      setAuthor(a => a ? { ...a, ...updated } : a);
    } catch {
      setPhotoError('Failed to upload portrait.');
    } finally {
      photoBusyRef.current = false;
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (photoBusyRef.current || !author) return;
    photoBusyRef.current = true;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const updated = await api.deleteAuthorPhoto(author.id);
      setAuthor(a => a ? { ...a, ...updated } : a);
    } catch {
      setPhotoError('Failed to remove portrait.');
    } finally {
      photoBusyRef.current = false;
      setPhotoBusy(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file in a row
    if (file) uploadPhoto(file);
  }

  // Paste-to-upload: while on the Author page, a clipboard image (Cmd/
  // Ctrl-V on a screenshot or copied portrait) lands directly on this
  // author. Listens on document so the user doesn't have to click a
  // specific element first — paste anywhere on the page works.
  useEffect(() => {
    if (!author) return;
    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); uploadPhoto(file); return; }
        }
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [author]);

  const fromState = useMemo(
    () => ({ from: author?.name, fromPath: pathname }),
    [author?.name, pathname],
  );


  return (
    <div>
      {/*
        Back: navigate directly to state.fromPath so the click destination
        matches the label. Pass no `state` so the destination renders
        fresh — otherwise we'd clobber its existing state with the current
        page's (the alias-loop A → B → A trap). Necessary for the R-chain:
        chain-preservation freezes the label at the original referrer
        through many random hops, and navigate(-1) would walk one step at
        a time, sending the user to the previous random author instead of
        where the label promises.
      */}
      <Link to={backPath} className="text-sm text-neutral-500 hover:text-neutral-200 transition-colors">
        {backLabel}
      </Link>

      <div className="mt-6 mb-8 flex flex-col sm:flex-row gap-6">
        {/* Portrait. Skeleton-style placeholder when no photo (OL miss
            or fetch failed) so the page still feels first-class.
            Clicking the portrait opens the file picker; pasting a
            clipboard image anywhere on the page also uploads to this
            author (paste handler is on document). */}
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={() => !photoBusy && fileInputRef.current?.click()}
            disabled={photoBusy || !author}
            className="group relative block w-32 h-40 sm:w-36 sm:h-44 rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-oak/50 disabled:cursor-wait"
            aria-label="Change portrait"
            title="Click to upload — or paste an image"
          >
            {author?.photo_path ? (
              <img
                src={author.photo_path}
                alt={author.name ? `Portrait of ${author.name}` : ''}
                className="w-full h-full object-cover bg-neutral-800"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-900 flex items-center justify-center text-neutral-700 text-3xl font-slab tracking-wide">
                {initialsFor(author?.name)}
              </div>
            )}
            <span className="absolute inset-0 bg-black/0 group-hover:bg-black/40 group-focus:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus:opacity-100 text-white text-xs font-medium">
              {photoBusy ? 'Uploading…' : (author?.photo_path ? 'Change portrait' : 'Upload portrait')}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />
          {author?.photo_path && (
            <button
              type="button"
              onClick={removePhoto}
              disabled={photoBusy}
              className="block mt-1.5 text-[11px] text-neutral-700 hover:text-warn transition-colors disabled:opacity-60"
            >
              Remove portrait
            </button>
          )}
          {photoError && <p role="alert" className="mt-1.5 text-[11px] text-warn">{photoError}</p>}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">Author</p>
          <h1 className="text-2xl font-bold text-white">{author?.name ?? (loading || errorKind === 'fetch' ? ' ' : 'Author not found')}</h1>
          {author?.aliases?.length > 0 && (
            <p className="text-neutral-600 text-xs mt-1">
              also writes as{' '}
              {author.aliases.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && (i === author.aliases.length - 1 ? ' & ' : ', ')}
                  <Link to={`/authors/${a.id}`} state={fromState} className="hover:text-neutral-400 transition-colors">
                    {a.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {!loading && author && (
            <p className="text-sm text-neutral-500 mt-1 flex items-center gap-2 flex-wrap">
              <span>{plural(author.total, 'book')}</span>
              {author.stories?.length > 0 && (
                <>
                  <span className="text-neutral-700">·</span>
                  <span>{plural(author.stories.length, 'story', 'stories')}</span>
                </>
              )}
              <span className="text-neutral-700">·</span>
              <GenderPicker
                value={author.gender}
                onChange={async (next) => {
                  const prev = author.gender;
                  setAuthor(a => ({ ...a, gender: next }));
                  try {
                    await api.updateAuthor(author.id, { gender: next });
                  } catch {
                    setAuthor(a => ({ ...a, gender: prev }));
                  }
                }}
              />
              <span className="text-neutral-700">·</span>
              <DatesPicker
                birth={author.birth_date}
                death={author.death_date}
                onChange={async (next) => {
                  const prev = { birth_date: author.birth_date, death_date: author.death_date };
                  setAuthor(a => ({ ...a, ...next }));
                  try {
                    await api.updateAuthor(author.id, next);
                  } catch {
                    setAuthor(a => ({ ...a, ...prev }));
                  }
                }}
              />
              <span className="text-neutral-700">·</span>
              {(() => {
                const isLoved = !!author.loved;
                const title   = isLoved ? 'Remove from loved' : 'Mark as loved';
                return (
                  <button
                    type="button"
                    onClick={toggleLoved}
                    disabled={loveBusy}
                    className={`transition-colors disabled:opacity-60 ${isLoved ? 'text-red-400 hover:text-red-300' : 'text-neutral-600 hover:text-neutral-300'}`}
                    title={title}
                    aria-label={`${title}: ${author.name}`}
                    aria-pressed={isLoved}
                  >
                    <span className="text-lg leading-none">{isLoved ? '♥' : '♡'}</span>
                  </button>
                );
              })()}
            </p>
          )}
          {loveError && (
            <p role="alert" className="text-xs text-warn mt-1">{loveError}</p>
          )}
          {!loading && author && (
            <div className="mt-3 group">
              {bioEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={bioDraft}
                    onChange={(e) => setBioDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') { setBioEditing(false); setBioError(null); }
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveBio(); }
                    }}
                    autoFocus
                    rows={6}
                    placeholder="Author bio…"
                    className="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20"
                    aria-label="Author bio"
                  />
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={saveBio}
                      disabled={bioSaving}
                      className="text-oak hover:text-leather transition-colors disabled:opacity-60 disabled:cursor-wait"
                    >
                      {bioSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setBioEditing(false); setBioError(null); }}
                      disabled={bioSaving}
                      className="text-neutral-600 hover:text-neutral-300 transition-colors"
                    >
                      Cancel
                    </button>
                    <span className="text-neutral-700">{MOD_KEY}+↵ to save · Esc to cancel</span>
                    {bioError && <span role="alert" className="text-warn ml-auto">{bioError}</span>}
                  </div>
                </div>
              ) : author.bio ? (
                <>
                  <div className="relative">
                    <p ref={bioRef} className={`text-sm text-neutral-400 whitespace-pre-line ${bioExpanded ? '' : 'line-clamp-4'}`}>
                      {author.bio}
                    </p>
                    {/* Soft fade at the clip when collapsed, so the line
                        cut reads as a deliberate fold rather than a hard
                        truncation. Gated to bios that actually overflow
                        the clamp (measured via useTextOverflow). */}
                    {!bioExpanded && bioOverflows && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-neutral-950 to-transparent" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs">
                    {/* Show-more toggle appears only when the rendered
                        bio actually exceeds its line-clamp — measured
                        via useTextOverflow rather than a char-count
                        proxy, so the button reflects what the user sees
                        instead of what we guessed about line height. */}
                    {bioOverflows && (
                      <button
                        type="button"
                        onClick={() => setBioExpanded(b => !b)}
                        className="text-oak hover:text-leather transition-colors"
                      >
                        {bioExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={startBioEdit}
                      className="text-neutral-700 hover:text-neutral-400 transition-colors opacity-60 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      ✎ Edit bio
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startBioEdit}
                  className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
                >
                  + Add bio
                </button>
              )}
            </div>
          )}
          {!loading && author && (
            <div className="mt-3 flex items-start gap-4 flex-wrap">
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing}
                className="text-[11px] text-neutral-700 hover:text-neutral-400 transition-colors disabled:opacity-60 disabled:cursor-wait"
                title="Re-fetch bio + portrait from Open Library"
              >
                {refreshing ? '↻ Refreshing…' : '↻ Refresh from Open Library'}
              </button>
              {/* Keyed on id so all merge-panel state resets when
                  navigating between authors. */}
              <MergeControl
                key={author.id}
                author={author}
                onMerged={() => {
                  // The merge changed this author's bibliography and
                  // deleted another author row — refetch this page and
                  // drop every cached author list/detail.
                  queryClient.invalidateQueries({ queryKey: ['author'] });
                  queryClient.invalidateQueries({ queryKey: ['authors'] });
                }}
              />
            </div>
          )}
          {refreshError && (
            <p role="alert" className="text-[11px] text-warn mt-1">{refreshError}</p>
          )}
        </div>
      </div>

      {loading ? (
        <GridSkeleton
          count={10}
          gridClassName="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5 items-start"
        />
      ) : errorKind === 'fetch' ? (
        <div className="text-center py-32">
          <p className="text-neutral-600">Failed to load author. Please try again.</p>
        </div>
      ) : errorKind === 'notfound' ? null
      : !author?.books?.length && !author?.stories?.length ? (
        <div className="text-neutral-600 text-sm">No books or story contributions by this author.</div>
      ) : (() => {
        const allBooks      = author.books || [];
        const stories       = author.stories || [];
        // Counts reflect what each toggle would actually reveal given the
        // current state of the other toggle — so "Show unowned (N)" is
        // honest about how many books would appear when ticked, not a
        // raw total that includes archived books a separate toggle is
        // still hiding. Was over-promising on the empty-state CTA when
        // all unowned books were also archived.
        // Available formats — drives the chip-row gating. Authors whose
        // entire bibliography is one format don't need the chips.
        const availableFormats = Array.from(new Set(allBooks.map(b => b.format).filter(Boolean))).sort();
        const fmtMatch = (b) => formatFilter == null || b.format === formatFilter;
        // The format filter narrows both counts so "Show unowned (3)"
        // means 3 unowned of the currently-filtered format, not 3 of any
        // format (which would over-promise on the empty-state CTA).
        const archivedCount = allBooks.filter(b => b.archived && (showUnowned || b.owned) && fmtMatch(b)).length;
        const unownedCount  = allBooks.filter(b => !b.owned && (showArchived || !b.archived) && fmtMatch(b)).length;
        let visibleBooks    = allBooks;
        if (!showArchived) visibleBooks = visibleBooks.filter(b => !b.archived);
        if (!showUnowned)  visibleBooks = visibleBooks.filter(b => b.owned);
        if (formatFilter)  visibleBooks = visibleBooks.filter(b => b.format === formatFilter);
        return (
          <>
            {allBooks.length > 0 && (
              <>
                {availableFormats.length > 1 && (
                  <div className="mb-4 flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setFormatFilter(null)}
                      aria-pressed={formatFilter == null}
                      className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                        formatFilter == null
                          ? 'bg-binding/50 text-parchment border-binding/70'
                          : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                      }`}
                    >
                      All formats
                    </button>
                    {availableFormats.map(f => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFormatFilter(formatFilter === f ? null : f)}
                        aria-pressed={formatFilter === f}
                        className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                          formatFilter === f
                            ? 'bg-binding/50 text-parchment border-binding/70'
                            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                        }`}
                      >
                        {FORMAT_LABEL[f] ?? f}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mb-4 flex items-center gap-4 flex-wrap">
                  <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                    <span>Sort:</span>
                    <select
                      value={sort}
                      onChange={(e) => {
                        const newSort = e.target.value;
                        userChangedSortRef.current = true;
                        setSort(newSort);
                        // Persist as the author's default_sort so the next
                        // visit lands on this sort. Fire-and-forget — a
                        // failed PATCH only costs cross-session memory.
                        api.updateAuthor(id, { default_sort: newSort }).catch(() => {});
                      }}
                      className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-300 hover:text-neutral-100 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 cursor-pointer transition-colors"
                      aria-label="Sort author's books"
                    >
                      <option value="year_published">Chronological</option>
                      <option value="year_published_desc">Reverse chronological</option>
                      <option value="title">Title</option>
                      <option value="rating">Rating</option>
                      <option value="added">Recently added</option>
                    </select>
                  </label>
                  {/* The Include-unowned toggle persists across format-chip
                      selections even when the current filter yields 0
                      unowned, so the user can always switch the toggle
                      on/off without bouncing back to All formats first. */}
                  {(unownedCount > 0 || availableFormats.length > 1) && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500 cursor-pointer hover:text-neutral-300 transition-colors">
                      <input
                        type="checkbox"
                        checked={showUnowned}
                        onChange={(e) => setShowUnowned(e.target.checked)}
                        className="accent-oak"
                      />
                      <span>Include unowned ({unownedCount})</span>
                    </label>
                  )}
                  {archivedCount > 0 && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500 cursor-pointer hover:text-neutral-300 transition-colors">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                        className="accent-oak"
                      />
                      <span>Show archived ({archivedCount})</span>
                    </label>
                  )}
                </div>
                {visibleBooks.length === 0 ? (
                  !showUnowned && unownedCount > 0 ? (
                    <div className="text-sm">
                      {/* Default owned-only view filtered to nothing — every
                          book by this author is either unowned or archived.
                          Acknowledge the unowned count and offer one click
                          to reveal it instead of reading as "no books". */}
                      <p className="text-neutral-600">
                        No owned books — {unownedCount} unowned.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowUnowned(true)}
                        className="mt-2 text-oak hover:text-leather transition-colors"
                      >
                        Show unowned →
                      </button>
                    </div>
                  ) : (
                    <div className="text-neutral-600 text-sm">
                      No books match the current filters.
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-5 items-start">
                    {/* cohort tracks the currently-visible cohort (post archived/
                        unowned toggles) so BookDetail's prev/next walks the same
                        view, not the raw author.books list. */}
                    {(() => {
                      const linkStateWithCohort = {
                        ...fromState,
                        cohort: visibleBooks.map(b => ({ id: b.id, title: b.title })),
                      };
                      return visibleBooks.map(book => <BookCard key={book.id} book={book} linkState={linkStateWithCohort} />);
                    })()}
                  </div>
                )}
              </>
            )}
            {stories.length > 0 && (
              <section className={allBooks.length > 0 ? 'mt-10' : ''} aria-labelledby="author-stories-heading">
                <h2 id="author-stories-heading" className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-2">
                  {plural(stories.length, 'story', 'stories')}
                </h2>
                <ul className="space-y-1.5">
                  {stories.map(s => (
                    <li key={s.story_id} className="text-sm text-neutral-300">
                      <span className="text-neutral-200">&ldquo;{s.story_title}&rdquo;</span>
                      <span className="text-neutral-500"> in </span>
                      <Link
                        to={`/books/${s.book_id}`}
                        state={fromState}
                        className="italic text-neutral-300 hover:text-parchment transition-colors"
                      >
                        {s.book_title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        );
      })()}
    </div>
  );
}
