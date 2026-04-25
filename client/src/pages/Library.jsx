import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { sortTitle } from '../utils.js';
import BookCard from '../components/BookCard.jsx';
import FilterPanel from '../components/FilterPanel.jsx';

const TABS = [
  { key: 'reading',  label: 'Reading' },
  { key: 'paused',   label: 'Paused' },
  { key: 'finished', label: 'Finished' },
  { key: 'unread',   label: 'Unread' },
  { key: 'owned',      label: 'Owned' },
  { key: 'prev_owned', label: 'Prev. owned' },
  { key: 'all',        label: 'All' },
];

const SESSION_KEY = 'spine-library-state';

const SORTS = [
  { key: 'updated',  label: 'Recently updated' },
  { key: 'added',    label: 'Recently added' },
  { key: 'title',    label: 'Title A–Z' },
  { key: 'author',   label: 'Author A–Z' },
  { key: 'rating',   label: 'Rating' },
  { key: 'progress', label: 'Progress' },
];

const GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7';

function progress(b) {
  if (b.format === 'audiobook') {
    return b.duration_minutes ? (b.current_minutes ?? 0) / b.duration_minutes : 0;
  }
  return b.page_count ? (b.current_page ?? 0) / b.page_count : 0;
}

function applySort(books, sort) {
  const sorted = [...books];
  if (sort === 'added')    return sorted.sort((a, b) => b.id - a.id);
  if (sort === 'title')    return sorted.sort((a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)) || (a.series_number ?? Infinity) - (b.series_number ?? Infinity));
  if (sort === 'author')   return sorted.sort((a, b) => (a.author || '').localeCompare(b.author || ''));
  if (sort === 'rating')   return sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  if (sort === 'progress') return sorted.sort((a, b) => progress(b) - progress(a));
  return sorted;
}

function getSaved() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) ?? {}; }
  catch { return {}; }
}

const EMPTY_FILTERS = {
  missing:    [],
  formats:    [],
  ratings:    [],
  publishers: [],
  series:     [],
  tags:       [],
  owned:          null,
  previouslyOwned: null,
  custom:         null,
  loved:          null,
};

function pruneFilters(filters, books) {
  const publishers = new Set(books.map(b => b.publisher || 'empty'));
  const series     = new Set(books.map(b => b.series     || 'empty'));
  const formats    = new Set(books.map(b => b.format     || 'empty'));
  const ratings    = new Set(books.map(b => String(b.rating ?? 'empty')));
  const tags       = new Set(books.flatMap(b => b.tags?.map(t => t.name) || []));
  return {
    ...filters,
    publishers: filters.publishers.filter(p => publishers.has(p)),
    series:     filters.series.filter(s => series.has(s)),
    formats:    filters.formats.filter(f => formats.has(f)),
    ratings:    filters.ratings.filter(r => ratings.has(String(r))),
    tags:       filters.tags.filter(t => tags.has(t)),
  };
}

function countFilters(f) {
  return f.missing.length + f.formats.length + f.ratings.length +
    f.publishers.length + f.series.length + f.tags.length +
    (f.owned !== null ? 1 : 0) + (f.previouslyOwned !== null ? 1 : 0) + (f.custom !== null ? 1 : 0) + (f.loved !== null ? 1 : 0);
}

function FilterIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
      <path fillRule="evenodd" d="M2 4a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4ZM4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8Zm2.75 3.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z" clipRule="evenodd" />
    </svg>
  );
}

function isManga(book) {
  return book.tags?.some(t => t.name.toLowerCase() === 'manga');
}

function buildDisplayItems(books, expandedSeries) {
  const mangaGroups = new Map();
  for (const book of books) {
    if (isManga(book) && book.series) {
      if (!mangaGroups.has(book.series)) mangaGroups.set(book.series, []);
      mangaGroups.get(book.series).push(book);
    }
  }
  const seenSeries = new Set();
  const items = [];
  for (const book of books) {
    if (isManga(book) && book.series && mangaGroups.get(book.series).length > 1) {
      if (!seenSeries.has(book.series)) {
        seenSeries.add(book.series);
        const groupBooks = mangaGroups.get(book.series);
        items.push({ type: 'series', name: book.series, books: groupBooks });
        if (expandedSeries.has(book.series)) {
          for (const vol of sortVolumes(groupBooks)) {
            items.push({ type: 'book', book: vol });
          }
        }
      }
    } else {
      items.push({ type: 'book', book });
    }
  }
  return items;
}

function sortVolumes(books) {
  return [...books].sort((a, b) =>
    (a.series_number ?? Infinity) - (b.series_number ?? Infinity) || sortTitle(a.title).localeCompare(sortTitle(b.title))
  );
}

function MangaSeriesCard({ seriesName, books, expanded, onToggle }) {
  const sorted = sortVolumes(books);
  const statusCounts = books.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});
  const statusParts = [
    statusCounts.reading  && `${statusCounts.reading} reading`,
    statusCounts.paused   && `${statusCounts.paused} paused`,
    statusCounts.finished && `${statusCounts.finished} finished`,
    statusCounts.unread   && `${statusCounts.unread} unread`,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`bg-card rounded-lg p-2 pb-2.5 hover:-translate-y-0.5 transition-[transform,background-color] ease-out duration-150 text-left w-full ${expanded ? 'ring-1 ring-binding/40' : ''}`}
    >
      <div className="relative aspect-[2/3] mb-2.5 rounded overflow-hidden shadow-xl ring-1 ring-white/5">
        {sorted.slice(0, 4).map((vol, i, arr) => {
          const n = arr.length;
          const leftPct = n === 1 ? 0 : (i * 45 / (n - 1));
          const width = n === 1 ? '100%' : '55%';
          return (
            <div
              key={vol.id}
              className="absolute top-0 bottom-0 overflow-hidden"
              style={{ left: `${leftPct}%`, width }}
            >
              {vol.cover_path ? (
                <img src={vol.cover_path} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-end p-2">
                  {i === n - 1 && (
                    <span className="text-xs text-neutral-400 font-medium leading-tight line-clamp-4">{seriesName}</span>
                  )}
                </div>
              )}
              {i > 0 && (
                <div className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/50 to-transparent pointer-events-none" />
              )}
            </div>
          );
        })}
        <div className="absolute top-1.5 right-1.5 bg-black/75 text-neutral-300 text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm leading-none">
          {books.length}
        </div>
      </div>
      <p className="text-sm font-medium text-neutral-200 truncate leading-tight" title={seriesName}>{seriesName}</p>
      {sorted[0]?.author && (
        <p className="text-xs text-neutral-500 truncate mt-0.5">{sorted[0].author}</p>
      )}
      {statusParts.length > 0 && (
        <p className="text-xs text-neutral-600 truncate mt-0.5">{statusParts.join(' · ')}</p>
      )}
    </button>
  );
}


export default function Library() {
  const [tab, setTab] = useState(() => getSaved().tab || 'reading');
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(() => getSaved().query || '');
  const [filtersOpen, setFiltersOpen] = useState(() => getSaved().filtersOpen ?? false);
  const [filters, setFilters] = useState(() => {
    const s = getSaved().filters;
    return s ? { ...EMPTY_FILTERS, ...s } : EMPTY_FILTERS;
  });
  const [sort, setSort] = useState(() => getSaved().sort || 'updated');
  const [expandedSeries, setExpandedSeries] = useState(new Set());
  const [counts, setCounts] = useState({});

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ tab, query, filtersOpen, filters, sort }));
  }, [tab, query, filtersOpen, filters, sort]);

  useEffect(() => {
    api.getBookCounts().then(setCounts).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getBooks(tab === 'all' ? null : (tab === 'owned' || tab === 'prev_owned') ? null : tab).then(books => {
      setBooks(books);
      setFilters(f => pruneFilters(f, books));
    }).finally(() => setLoading(false));
  }, [tab]);

  const activeCount = countFilters(filters);

  const filtered = books.filter(b => {
    if (tab === 'owned'      && !b.owned)            return false;
    if (tab === 'prev_owned' && !b.previously_owned) return false;

    if (query.trim() && !(
      b.title.toLowerCase().includes(query.toLowerCase()) ||
      (b.author  && b.author.toLowerCase().includes(query.toLowerCase())) ||
      (b.series  && b.series.toLowerCase().includes(query.toLowerCase())) ||
      b.tags?.some(t => t.name.toLowerCase().includes(query.toLowerCase()))
    )) return false;

    if (filters.missing.includes('cover')     && b.cover_path)            return false;
    if (filters.missing.includes('author')    && b.author)                return false;
    if (filters.missing.includes('format')    && b.format)                return false;
    if (filters.missing.includes('isbn')      && (b.is_custom || b.isbn_10 || b.isbn_13 || b.asin)) return false;
    if (filters.missing.includes('isbn')      && (b.year_published < 1970 && !(b.year_edition >= 1970))) return false;
    if (filters.missing.includes('publisher') && b.publisher)             return false;
    if (filters.missing.includes('year')      && b.year_published)        return false;
    if (filters.missing.includes('pages')     && (b.format === 'audiobook' ? b.duration_minutes : b.page_count)) return false;
    if (filters.missing.includes('language')  && b.language)              return false;
    if (filters.missing.includes('rating')       && (b.rating || b.status !== 'finished')) return false;
    if (filters.missing.includes('fiction')      && b.fiction !== null && b.fiction !== undefined) return false;
    if (filters.missing.includes('description')  && b.description)          return false;

    if (filters.formats.length    > 0 && !filters.formats.includes(b.format    || 'empty')) return false;
    if (filters.ratings.length    > 0 && !filters.ratings.includes(b.rating    || 'empty')) return false;
    if (filters.publishers.length > 0 && !filters.publishers.includes(b.publisher || 'empty')) return false;
    if (filters.series.length     > 0 && !filters.series.includes(b.series     || 'empty')) return false;
    if (filters.tags.length > 0 && !filters.tags.some(t => b.tags?.some(bt => bt.name === t))) return false;
    if (filters.owned === true  && !b.owned) return false;
    if (filters.owned === false &&  b.owned) return false;
    if (filters.previouslyOwned === true  && !b.previously_owned) return false;
    if (filters.previouslyOwned === false &&  b.previously_owned) return false;
    if (filters.custom === true  && !b.is_custom) return false;
    if (filters.custom === false &&  b.is_custom) return false;
    if (filters.loved  === true  && !b.loved)     return false;
    if (filters.loved  === false &&  b.loved)     return false;

    return true;
  });

  const sortedFiltered = applySort(filtered, sort);
  const displayItems = buildDisplayItems(sortedFiltered, expandedSeries);

  function handleProgressUpdate(updated) {
    setBooks(bs => {
      const statusTabs = ['reading', 'paused', 'finished', 'unread'];
      if (statusTabs.includes(tab) && updated.status !== tab) {
        return bs.filter(b => b.id !== updated.id);
      }
      return bs.map(b => b.id === updated.id ? updated : b);
    });
  }

  function toggleSeries(name) {
    setExpandedSeries(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div>
      <div className="flex flex-col gap-3 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex gap-1 bg-neutral-900 p-1 rounded-lg w-fit">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-2 text-sm rounded-md whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 active:scale-[0.98] ${
                  tab === t.key
                    ? 'bg-binding/25 text-parchment font-semibold'
                    : 'font-medium text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t.label}{counts[t.key] != null ? <span className="ml-1.5 text-xs opacity-50 tabular-nums">{counts[t.key]}</span> : null}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 transition-colors duration-150"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or author…"
              className="bg-neutral-800 border border-leather/30 rounded-lg px-4 py-2 text-sm text-parchment placeholder-neutral-500 focus:outline-none focus:border-leather/70 focus:ring-1 focus:ring-oak/25 transition-colors duration-150 w-full sm:w-56"
            />
            <button
              onClick={() => setFiltersOpen(o => !o)}
              className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 active:scale-[0.98] ${
                filtersOpen || activeCount > 0
                  ? 'bg-binding/25 text-parchment'
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FilterIcon />
              Filters
              {activeCount > 0 && (
                <span className="bg-oak text-neutral-950 text-xs font-bold w-4 h-4 flex items-center justify-center rounded-full leading-none ml-0.5">
                  {activeCount}
                </span>
              )}
            </button>
            {activeCount > 0 && (
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors whitespace-nowrap"
              >
                Clear all
              </button>
            )}
            <span className="text-xs text-neutral-600 tabular-nums whitespace-nowrap">
              {sortedFiltered.length} {sortedFiltered.length === 1 ? 'book' : 'books'}
            </span>
          </div>
        </div>

        {filtersOpen && (
          <FilterPanel allBooks={books} filters={filters} onChange={setFilters} />
        )}
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : sortedFiltered.length === 0 ? (
        <div className="text-center py-32">
          {query || activeCount > 0 ? (
            <p className="text-neutral-600">No books match the current filters.</p>
          ) : (
            <>
              <p className="text-neutral-600 mb-3">Nothing here yet.</p>
              <Link to="/books/new" className="text-sm text-oak hover:text-leather">
                Add your first book →
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className={GRID}>
          {displayItems.map(item =>
            item.type === 'series' ? (
              <MangaSeriesCard
                key={item.name}
                seriesName={item.name}
                books={item.books}
                expanded={expandedSeries.has(item.name)}
                onToggle={() => toggleSeries(item.name)}
              />
            ) : (
              <BookCard
                key={item.book.id}
                book={item.book}
                onProgressUpdate={handleProgressUpdate}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
