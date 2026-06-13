import { useEffect, useMemo } from 'react';
import { Link, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { nrm } from '../utils.js';
import { useFreshFetch } from '../hooks/useFreshFetch.js';
import IncomingBackLink from '../components/IncomingBackLink.jsx';
import PageHeading from '../components/PageHeading.jsx';

// Sort modes for the Authors index. Name is the default (alphabetical
// scan / who-is-in-my-library reference); the rest are curation flows
// that surface gaps (missing bio / photo / dates / gender) or freshness
// (recently added). Each sort falls back to name for stable ordering
// within ties.
const SORTS = [
  { key: 'name',      label: 'Name' },
  { key: 'books',     label: 'Books' },
  { key: 'stories',   label: 'Stories' },
  { key: 'no_bio',    label: 'Missing bio' },
  { key: 'stale_tense', label: 'Stale-tense bio' },
  { key: 'no_photo',  label: 'Missing photo' },
  { key: 'no_dates',  label: 'Missing dates' },
  { key: 'no_gender', label: 'Missing gender' },
  { key: 'recent',    label: 'Recently added' },
];
const VALID_SORTS = new Set(SORTS.map(s => s.key));

// URL whitelist — sanitises old bookmarks with stale params and stops
// unrelated query params from sticking around when this page replaces
// them on update.
const VALID_PARAMS = new Set(['q', 'sort']);
// localStorage key for the page-level sort preference. Persists the
// most-recent non-default sort across cold-start navigations (clicking
// the top-nav "Authors" link, opening a fresh tab) where the URL has no
// `?sort=` to carry the choice. Mirror of Library's per-tab sortByTab.
const LS_SORT_KEY = 'spine.authorsIndexSort';
function pickValidParams(src) {
  const out = new URLSearchParams();
  for (const [k, v] of src.entries()) {
    if (VALID_PARAMS.has(k)) out.set(k, v);
  }
  return out;
}

// "1938-07-18" → "1938"; "-428-..." → "428 BCE"; null → null. The index
// only shows the year — full precision lives on the detail page.
function yearLabel(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(-?\d{1,4})/);
  if (!m) return String(dateStr);
  const y = parseInt(m[1], 10);
  return y < 0 ? `${-y} BCE` : String(y);
}

function lifespanLabel(birth, death) {
  const b = yearLabel(birth);
  const d = yearLabel(death);
  if (!b && !d) return null;
  if (b && d)   return `${b}–${d}`;
  if (b)        return `${b}–`;
  return `–${d}`;
}

// Single-letter gender glyphs keep the column tight; '—' marks unassigned
// rows so they're visually equivalent to other empty-cell hints.
const GENDER_GLYPH = { male: 'm', female: 'f', other: 'o' };

// Calm, dense table of every author with curation-state indicators.
// Filled cells are dim ('·' / value); missing cells use '—' in a
// slightly warmer hue so they pop on scan. Click a row to open the
// detail page.
export default function AuthorsIndex() {
  const { data: authors, loading, error } = useFreshFetch(
    () => api.getAuthors(),
    [],
    { initialData: [] },
  );
  // URL is the source of truth for filter+sort so views like "Missing
  // photo + name=eg" survive refresh / back/forward / shareable links
  // (matches Library / Diary / Browse / Collage). Both updates use
  // replace:true — filter state is view config, not navigation, and a
  // history entry per keystroke would clog back/forward.
  const [params, setParams] = useSearchParams();
  const { pathname, search, state } = useLocation();
  // Back-link contract for any detail page reached from a row click —
  // matches Author/BrowsePage's { from, fromPath } shape so '← Authors'
  // returns to the current filter+sort view, not the Library default.
  const fromState = { from: 'Authors', fromPath: pathname + search };
  const query = params.get('q') ?? '';
  const sort  = VALID_SORTS.has(params.get('sort')) ? params.get('sort') : 'name';

  // On mount: (1) drop any unknown query params so a stale bookmark from
  // a prior version doesn't sit there cluttering the URL; (2) if no
  // ?sort= is in the URL, seed it from localStorage so the user's last
  // chosen sort persists across cold-start navigations (top-nav clicks,
  // fresh tabs). URL still wins over localStorage when it carries a
  // sort, so bookmarked audit views (?sort=stale_tense) behave as
  // expected. Pass `state` through so a Stats-arrived '← Stats' back
  // link survives the replace.
  useEffect(() => {
    const next = pickValidParams(params);
    let changed = Array.from(params.keys()).some(k => !VALID_PARAMS.has(k));
    if (!next.has('sort')) {
      // Safari private mode throws on storage access; treat as no memory.
      let stored = null;
      try { stored = localStorage.getItem(LS_SORT_KEY); } catch {}
      // Only seed when the stored value is a real non-default sort —
      // 'name' is the implicit default and lives as an absent param.
      if (stored && stored !== 'name' && VALID_SORTS.has(stored)) {
        next.set('sort', stored);
        changed = true;
      }
    }
    if (changed) setParams(next, { replace: true, state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the resolved sort to localStorage on every change so the
  // page-level memory tracks the URL. Writes 'name' (the default) too,
  // so a user who explicitly picks Name after picking Books still has
  // their choice remembered as the new sticky default.
  useEffect(() => {
    try { localStorage.setItem(LS_SORT_KEY, sort); } catch {}
  }, [sort]);

  function updateParam(key, value) {
    const next = pickValidParams(params);
    if (value === '' || value == null) next.delete(key);
    else                                next.set(key, String(value));
    setParams(next, { replace: true, state });
  }

  const counts = useMemo(() => ({
    total:     authors.length,
    withBio:   authors.filter(a => a.has_bio).length,
    withPhoto: authors.filter(a => a.has_photo).length,
    withDates: authors.filter(a => a.birth_date || a.death_date).length,
    withGender: authors.filter(a => a.gender).length,
  }), [authors]);

  const filtered = useMemo(() => {
    // nrm() folds diacritics so "lem" matches "Stanisław Lem" and
    // "etienne" matches "Étienne de La Boétie" — same shape the
    // server's nrm() applies on the CommandPalette author search, so
    // both surfaces agree on what counts as a match.
    const q = nrm(query.trim());
    const rows = q
      ? authors.filter(a => nrm(a.name).includes(q))
      : authors.slice();
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    switch (sort) {
      case 'books':     rows.sort((a, b) => b.book_count - a.book_count || byName(a, b)); break;
      case 'stories':   rows.sort((a, b) => (b.story_count || 0) - (a.story_count || 0) || byName(a, b)); break;
      case 'no_bio':    rows.sort((a, b) => (a.has_bio - b.has_bio) || byName(a, b)); break;
      case 'stale_tense': rows.sort((a, b) => ((b.has_stale_tense || 0) - (a.has_stale_tense || 0)) || byName(a, b)); break;
      case 'no_photo':  rows.sort((a, b) => (a.has_photo - b.has_photo) || byName(a, b)); break;
      case 'no_dates':  rows.sort((a, b) => (Number(!!a.birth_date || !!a.death_date) - Number(!!b.birth_date || !!b.death_date)) || byName(a, b)); break;
      case 'no_gender': rows.sort((a, b) => (Number(!!a.gender) - Number(!!b.gender)) || byName(a, b)); break;
      case 'recent':    rows.sort((a, b) => b.id - a.id); break;
      default:          rows.sort(byName);
    }
    return rows;
  }, [authors, query, sort]);

  const missing = <span className="text-oak/50">—</span>;
  const present = <span className="text-neutral-500">✓</span>;

  return (
    <div className="max-w-5xl">
      <IncomingBackLink />
      <header className="mb-6">
        <PageHeading>Authors</PageHeading>
        {!loading && !error && (
          <p className="text-xs text-neutral-600 mt-2">
            {counts.total} authors · {counts.withBio} with bios · {counts.withPhoto} with portraits · {counts.withDates} with dates · {counts.withGender} with gender
          </p>
        )}
      </header>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={(e) => updateParam('q', e.target.value)}
          placeholder="Filter by name"
          aria-label="Filter authors by name"
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
      {error && <p role="alert" className="text-sm text-warn">Failed to load authors.</p>}

      {!loading && !error && filtered.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-600 border-b border-neutral-800/60">
            <tr>
              <th className="text-left  py-2 pr-3">Name</th>
              <th className="text-right py-2 px-3 w-16">Books</th>
              <th className="text-right py-2 px-3 w-16" title="Stories contributed (anthology entries not bylined on the containing book)">Stories</th>
              <th className="text-center py-2 px-3 w-12">Bio</th>
              <th className="text-center py-2 px-3 w-14">Photo</th>
              <th className="text-left  py-2 px-3 w-40">Dates</th>
              <th className="text-center py-2 px-3 w-12" title="Gender">G</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const lifespan = lifespanLabel(a.birth_date, a.death_date);
              const gender = a.gender ? GENDER_GLYPH[a.gender] ?? a.gender : null;
              return (
                <tr key={a.id} className="border-b border-neutral-900 hover:bg-neutral-900/50 transition-colors">
                  <td className="py-1.5 pr-3">
                    <Link to={`/authors/${a.id}`} state={fromState} className="text-neutral-300 hover:text-parchment transition-colors">
                      {a.name}
                    </Link>
                  </td>
                  <td className="text-right py-1.5 px-3 text-neutral-500 tabular-nums">{a.book_count}</td>
                  <td className="text-right py-1.5 px-3 text-neutral-500 tabular-nums">{a.story_count || 0}</td>
                  <td className="text-center py-1.5 px-3">{a.has_bio   ? present : missing}</td>
                  <td className="text-center py-1.5 px-3">{a.has_photo ? present : missing}</td>
                  <td className="py-1.5 px-3 text-neutral-500">{lifespan ?? missing}</td>
                  <td className="text-center py-1.5 px-3 text-neutral-500">{gender ?? missing}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-neutral-500 mt-4">No authors match the current filters.</p>
      )}
    </div>
  );
}
