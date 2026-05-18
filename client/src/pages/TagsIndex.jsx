import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api.js';
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
  const { pathname, search }  = useLocation();
  // Back-link contract — '← Tags' on BrowsePage returns to the current
  // filter+sort view, not the Library default.
  const fromState = { from: 'Tags', fromPath: pathname + search };
  const query = params.get('q') ?? '';
  const sort  = VALID_SORTS.has(params.get('sort')) ? params.get('sort') : 'name';

  // Drop any unknown query params on mount so a stale bookmark from a
  // prior version doesn't sit there cluttering the URL.
  useEffect(() => {
    if (Array.from(params.keys()).some(k => !VALID_PARAMS.has(k))) {
      setParams(pickValidParams(params), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateParam(key, value) {
    const next = pickValidParams(params);
    if (value === '' || value == null) next.delete(key);
    else                                next.set(key, String(value));
    setParams(next, { replace: true });
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
    const q = query.trim().toLowerCase();
    const rows = q
      ? tags.filter(t => t.name.toLowerCase().includes(q))
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
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-oak/50 w-72"
        />
        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value === 'name' ? null : e.target.value)}
          className="bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50"
          aria-label="Sort"
        >
          {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}

      {!loading && !error && (
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
        <p className="text-sm text-neutral-500 mt-4">No tags match the filter.</p>
      )}
    </div>
  );
}
