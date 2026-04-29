import { useState, useRef } from 'react';
import { api } from '../../api.js';

// Top-of-page Open Library search. Owns its own query/results state and
// debounces the search call. Calls `onApply(result)` when a result is picked.
export default function LookupPanel({ onApply }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef(null);

  function handleInput(e) {
    const q = e.target.value;
    setQuery(q);
    setResults([]);
    clearTimeout(debounce.current);
    if (!q.trim()) return;
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try { setResults(await api.searchBooks(q)); }
      finally { setSearching(false); }
    }, 400);
  }

  async function handlePick(result) {
    setQuery('');
    setResults([]);
    await onApply(result);
  }

  return (
    <div className="relative mb-8">
      <input
        type="search"
        value={query}
        onChange={handleInput}
        placeholder="Search Open Library to auto-fill…"
        className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-oak/60 focus:ring-1 focus:ring-oak/25 transition-colors duration-150"
      />
      {searching && <p className="absolute right-3 top-2.5 text-xs text-neutral-600">Searching…</p>}
      {results.length > 0 && (
        <ul className="absolute z-10 w-full mt-1 bg-neutral-900 border border-neutral-700 rounded-lg overflow-hidden shadow-xl">
          {results.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => handlePick(r)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800 transition-colors">
                {r.cover_url
                  ? <img src={r.cover_url} alt="" className="w-8 h-12 object-cover rounded flex-shrink-0" />
                  : <div className="w-8 h-12 bg-neutral-800 rounded flex-shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm text-white truncate" title={r.title}>{r.title}</p>
                  {r.authors?.length > 0 && <p className="text-xs text-neutral-500 truncate">{r.authors.join(', ')}</p>}
                  {r.publisher && <p className="text-xs text-neutral-600 truncate">{r.publisher}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
