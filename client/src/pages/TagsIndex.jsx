import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { nrm } from '../utils.js';
import IncomingBackLink from '../components/IncomingBackLink.jsx';

// Sort modes for the Tags index. Name (alphabetical scan) is the
// default. Books asc surfaces prune candidates (single-book tags worth
// merging or removing) — the primary curation flow. Books desc shows
// the most-used tags. Recently added uses tag id since the tags table
// has no created_at column.
const SORTS = [
  { key: 'name',       label: 'Name' },
  { key: 'books_desc', label: 'Books, most first' },
  { key: 'books_asc',  label: 'Books, fewest first' },
  { key: 'recent',     label: 'Recently added' },
];
const VALID_SORTS = new Set(SORTS.map(s => s.key));

// URL whitelist — same pattern as Authors / Collage so stale params
// from old bookmarks don't haunt new versions.
const VALID_PARAMS = new Set(['q', 'sort']);
// localStorage key for the page-level sort preference. Mirrors
// AuthorsIndex's LS_SORT_KEY pattern — the URL still wins when present
// (so bookmarks behave), but cold-start nav restores the last choice.
const LS_SORT_KEY = 'spine.tagsIndexSort';
function pickValidParams(src) {
  const out = new URLSearchParams();
  for (const [k, v] of src.entries()) {
    if (VALID_PARAMS.has(k)) out.set(k, v);
  }
  return out;
}

export default function TagsIndex() {
  const [tags,    setTags]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [params, setParams]   = useSearchParams();
  const { pathname, search, state }  = useLocation();
  // Back-link contract — '← Tags' on BrowsePage returns to the current
  // filter+sort view, not the Library default.
  const fromState = { from: 'Tags', fromPath: pathname + search };
  const query = params.get('q') ?? '';
  const sort  = VALID_SORTS.has(params.get('sort')) ? params.get('sort') : 'name';

  // On mount: drop unknown params AND seed sort from localStorage when
  // URL has no ?sort=. Same pattern as AuthorsIndex — URL wins, but the
  // last picked sort persists across cold-start navigations.
  useEffect(() => {
    const next = pickValidParams(params);
    let changed = Array.from(params.keys()).some(k => !VALID_PARAMS.has(k));
    if (!next.has('sort')) {
      let stored = null;
      try { stored = localStorage.getItem(LS_SORT_KEY); } catch {}
      if (stored && stored !== 'name' && VALID_SORTS.has(stored)) {
        next.set('sort', stored);
        changed = true;
      }
    }
    if (changed) setParams(next, { replace: true, state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the resolved sort to localStorage on every change.
  useEffect(() => {
    try { localStorage.setItem(LS_SORT_KEY, sort); } catch {}
  }, [sort]);

  function updateParam(key, value) {
    const next = pickValidParams(params);
    if (value === '' || value == null) next.delete(key);
    else                                next.set(key, String(value));
    setParams(next, { replace: true, state });
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getTags()
      .then(setTags)
      .catch(() => setError('Failed to load tags.'))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const total = tags.length;
    const single = tags.filter(t => t.book_count === 1).length;
    return { total, single };
  }, [tags]);

  const filtered = useMemo(() => {
    // nrm() folds diacritics so the filter matches the CommandPalette
    // server-side search. Most tags are ASCII but applying for
    // consistency with AuthorsIndex / SeriesIndex.
    const q = nrm(query.trim());
    const rows = q
      ? tags.filter(t => nrm(t.name).includes(q))
      : tags.slice();
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    switch (sort) {
      case 'books_desc': rows.sort((a, b) => b.book_count - a.book_count || byName(a, b)); break;
      case 'books_asc':  rows.sort((a, b) => a.book_count - b.book_count || byName(a, b)); break;
      case 'recent':     rows.sort((a, b) => b.id - a.id); break;
      default:           rows.sort(byName);
    }
    return rows;
  }, [tags, query, sort]);

  return (
    <div className="max-w-3xl">
      <IncomingBackLink />
      <header className="mb-6">
        <h1 className="text-2xl font-slab text-parchment uppercase tracking-wider">Tags</h1>
        {!loading && !error && (
          <p className="text-xs text-neutral-600 mt-2">
            {counts.total} tags · {counts.single} used by a single book
          </p>
        )}
      </header>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={(e) => updateParam('q', e.target.value)}
          placeholder="Filter by name"
          aria-label="Filter tags by name"
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 w-72"
        />
        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value === 'name' ? null : e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20"
          aria-label="Sort"
        >
          {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {loading && <p role="status" className="text-sm text-neutral-500">Loading…</p>}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}

      {!loading && !error && filtered.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-600 border-b border-neutral-800/60">
            <tr>
              <th className="text-left  py-2 pr-3">Name</th>
              <th className="text-right py-2 px-3 w-20">Books</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-b border-neutral-900 hover:bg-neutral-900/50 transition-colors">
                <td className="py-1.5 pr-3">
                  <Link to={`/browse/tag/${encodeURIComponent(t.name)}`} state={fromState} className="text-neutral-300 hover:text-parchment transition-colors">
                    {t.name}
                  </Link>
                </td>
                <td className="text-right py-1.5 px-3 text-neutral-500 tabular-nums">{t.book_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-neutral-500 mt-4">No tags match the current filters.</p>
      )}
    </div>
  );
}
