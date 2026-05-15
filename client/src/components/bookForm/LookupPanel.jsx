import { useState, useRef, useEffect } from 'react';
import { api } from '../../api.js';

// Top-of-page Open Library search. Owns its own query/results state and
// debounces the search call. Calls `onApply(result)` when a result is picked.
// coverInFlight gates the result-apply buttons: picking a result while a
// cover upload/fetch is running would race two cover writes — onApply's
// cover branch silently no-ops (the shared coverActionRef catches it),
// leaving the user with B's metadata but A's cover. Mirrors the picker-
// controls disable in BookForm.
export default function LookupPanel({ onApply, coverInFlight }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const debounce = useRef(null);
  // Stale-response guard: a slow Open Library response from an earlier
  // keystroke can land AFTER a newer request finished, repopulating the
  // dropdown with results for a query the user has since revised, cleared,
  // or already picked from. Each runSearch captures its gen and drops its
  // own state writes if a newer call (or a clear/pick) has bumped the ref.
  const searchGenRef = useRef(0);
  // Synchronous in-flight guard: handlePick is async (awaits onApply), and the
  // setResults([]) that hides the dropdown doesn't take effect until after the
  // handler returns. A same-tick double-click on a result would otherwise fire
  // onApply twice and race two description-fetch / form-fill passes.
  const pickingRef = useRef(false);

  // Unmount cleanup. Without this, navigating away within the 400ms
  // debounce window fires runSearch on a dead component, and any
  // already in-flight Open Library response lands as a setState on
  // an unmounted instance. Clearing the timer kills the pending
  // search, and bumping searchGenRef invalidates any response still
  // in flight so the guards in runSearch all hit.
  useEffect(() => () => {
    clearTimeout(debounce.current);
    searchGenRef.current++;
  }, []);

  async function runSearch(q) {
    if (!q.trim()) return;
    const gen = ++searchGenRef.current;
    setSearching(true);
    setError(null);
    try {
      const r = await api.searchBooks(q);
      if (gen !== searchGenRef.current) return;
      setResults(r);
    } catch {
      if (gen !== searchGenRef.current) return;
      setError('Open Library search failed — please try again.');
    } finally {
      // Spinner only flips off for the LATEST request; a stale response that
      // arrives while a newer one is still in flight must leave it on.
      if (gen === searchGenRef.current) setSearching(false);
    }
  }

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    setResults([]);
    setError(null);
    clearTimeout(debounce.current);
    if (!q.trim()) {
      // Bump gen so any in-flight request can't repopulate the dropdown
      // after the user has emptied the field.
      searchGenRef.current++;
      setSearching(false);
      return;
    }
    debounce.current = setTimeout(() => runSearch(q), 400);
  }

  function handleKeyDown(e) {
    // Enter flushes the 400ms debounce — useful when pasting an ISBN.
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounce.current);
      runSearch(query);
    }
  }

  async function handlePick(result) {
    if (pickingRef.current) return;
    // Defensive: the result buttons are also disabled when coverInFlight,
    // but the prop-passing is async-by-render whereas pickingRef is
    // synchronous. Bail here too so a click that lands between the cover
    // action starting and React re-rendering with disabled buttons can't
    // slip through.
    if (coverInFlight) return;
    pickingRef.current = true;
    // Same gen-bump rationale: an earlier in-flight search must not pop the
    // dropdown back open after the user has already chosen a result.
    searchGenRef.current++;
    setQuery('');
    setResults([]);
    setSearching(false);
    try {
      await onApply(result);
    } finally {
      pickingRef.current = false;
    }
  }

  return (
    <div className="relative mb-8">
      <input
        type="search"
        value={query}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        aria-label="Search Open Library"
        placeholder="Search Open Library to auto-fill…"
        // Right padding expands while the absolutely-positioned
        // 'Searching…' status sits over the input so a long query
        // doesn't visually run under it. Stays at px-4 when idle so
        // typed text uses the full width.
        className={`w-full bg-neutral-800 border border-neutral-700 rounded-lg py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-oak/60 focus:ring-1 focus:ring-oak/25 transition-colors duration-150 ${searching ? 'pl-4 pr-24' : 'px-4'}`}
      />
      {searching && <p role="status" className="absolute right-3 top-2.5 text-xs text-neutral-600 pointer-events-none">Searching…</p>}
      {error && results.length === 0 && (
        <p role="alert" className="absolute z-10 w-full mt-1 px-4 py-2 text-xs text-warn bg-neutral-900 border border-neutral-700 rounded-lg">
          {error}
        </p>
      )}
      {results.length > 0 && (
        // Wrapper holds the optional in-flight notice + result list so
        // both share the dropdown's absolute positioning. The inline
        // notice is the sole user-facing explanation for disabled
        // result buttons — disabled-button title tooltips don't surface
        // on touch and aren't reliably announced by screen readers, so
        // a visible inline message is the accessible choice.
        //
        // role='status' (implicit aria-live='polite') announces the
        // notice non-interruptively for screen readers, matching the
        // Searching… indicator above and the same indicator in
        // EditionsSection. The element is conditionally rendered;
        // modern screen readers re-scan polite regions on subtree
        // mutations, so the new <p> is announced when it appears.
        <div className="absolute z-10 w-full mt-1 bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden shadow-xl">
          {coverInFlight && (
            <p id="lookup-cover-in-flight-notice" role="status" className="px-4 py-2 text-xs text-neutral-400 border-b border-neutral-800">
              A cover action is in progress — wait for it to finish.
            </p>
          )}
          <ul>
            {results.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => handlePick(r)}
                  disabled={coverInFlight}
                  aria-describedby={coverInFlight ? 'lookup-cover-in-flight-notice' : undefined}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                  {r.cover_url
                    ? <img src={r.cover_url} alt="" className="w-8 h-12 object-cover rounded flex-shrink-0" />
                    : <div className="w-8 h-12 bg-neutral-800 rounded flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate" title={r.title}>{r.title}</p>
                    {r.authors?.length > 0 && <p className="text-xs text-neutral-500 truncate" title={r.authors.join(', ')}>{r.authors.join(', ')}</p>}
                    {r.publisher && <p className="text-xs text-neutral-600 truncate" title={r.publisher}>{r.publisher}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
