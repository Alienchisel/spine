import { useEffect, useRef, useState } from 'react';
import { initialsFor } from '../utils.js';

// Below-row search input. Type → debounced lookup via the section's
// own `search(q)` callback; click a result → `onAdd(item)`. The picker
// stays unobtrusive (low-contrast input, slim dropdown) so the page
// reads cover-first when not curating. When the row is already full
// the input is disabled with a hint pointing at the row's ✕ buttons —
// no second swap modal here since the user can already see all five
// picks above and pick one to remove directly.
//
// Each section normalizes its results into a generic shape:
//   { id, label, image_path, alreadyIn, hint }
// `alreadyIn` greys out rows that already occupy a slot (so the dedup
// signal is visible instead of clicking through to a server no-op).
// `hint` is the small trailing copy (e.g. "2 books", a year).
export default function ShowcaseAddPicker({ placeholder, search, onAdd, disabled, disabledHint }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  // Per-row in-flight guard so a fast double-click on the same match
  // can't fire two parallel onAdd calls before the picker clears.
  const [busyKey, setBusyKey] = useState(null);
  const debounce = useRef(null);
  const inputRef = useRef(null);
  // Stale-guard pattern mirrors the QuickAdd and AddBookHere pickers —
  // bumped on every keystroke so a slow response from an earlier query
  // can't repopulate the dropdown after the user has revised the field.
  const queryEpochRef = useRef(0);

  useEffect(() => {
    clearTimeout(debounce.current);
    const term = q.trim();
    if (!term) {
      queryEpochRef.current += 1;
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    queryEpochRef.current += 1;
    const epoch = queryEpochRef.current;
    debounce.current = setTimeout(async () => {
      try {
        const rows = await search(term);
        if (epoch !== queryEpochRef.current) return;
        setMatches(Array.isArray(rows) ? rows : []);
      } catch {
        if (epoch !== queryEpochRef.current) return;
        setMatches([]);
      } finally {
        if (epoch === queryEpochRef.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(debounce.current);
  }, [q, search]);

  async function pick(item) {
    if (busyKey != null || item.alreadyIn) return;
    setBusyKey(item.id);
    setError(null);
    try {
      await onAdd(item);
      setQ('');
      setMatches([]);
      inputRef.current?.focus();
    } catch (err) {
      setError(err?.message || 'Failed to add.');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="mt-4 relative">
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={disabled ? (disabledHint || 'Showcase row is full.') : placeholder}
        disabled={disabled}
        aria-label={placeholder}
        // Slim, low-contrast — sits below the row of covers without
        // competing for attention. Border picks up on focus.
        className="w-full bg-neutral-900/60 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-oak/40 focus:bg-neutral-900 transition-colors disabled:opacity-50 disabled:cursor-default"
      />
      {error && <p role="alert" className="text-xs text-warn mt-1">{error}</p>}

      {!disabled && q.trim() && (matches.length > 0 || searching) && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1.5 bg-neutral-900 border border-neutral-800 rounded-lg shadow-lg max-h-80 overflow-y-auto">
          {searching && matches.length === 0 ? (
            <div className="px-3 py-3 text-xs text-neutral-500">Searching…</div>
          ) : (
            matches.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => pick(item)}
                disabled={busyKey != null || item.alreadyIn}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${item.alreadyIn ? 'cursor-default opacity-50' : 'hover:bg-neutral-800'} disabled:cursor-default`}
              >
                <div className="w-8 h-12 flex-shrink-0 bg-neutral-800 rounded-sm overflow-hidden">
                  {item.image_path ? (
                    <img src={item.image_path} alt="" className="w-full h-full object-cover object-top" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900">
                      <span className="text-[10px] font-bold text-neutral-500 select-none">{initialsFor(item.label)}</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-parchment truncate">{item.label}</div>
                  {item.hint && <div className="text-xs text-neutral-500 truncate">{item.hint}</div>}
                </div>
                <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                  {item.alreadyIn ? 'On Showcase' : '+ Add'}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
