import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import BookCard from '../components/BookCard.jsx';
import FilterPanel from '../components/FilterPanel.jsx';

const TABS = [
  { key: 'reading',  label: 'Reading' },
  { key: 'paused',   label: 'Paused' },
  { key: 'finished', label: 'Finished' },
  { key: 'unread',   label: 'Unread' },
  { key: 'owned',    label: 'Owned' },
  { key: 'all',      label: 'All' },
];

const SESSION_KEY = 'spine-library-state';

const SORTS = [
  { key: 'updated',  label: 'Recently updated' },
  { key: 'title',    label: 'Title A–Z' },
  { key: 'author',   label: 'Author A–Z' },
  { key: 'rating',   label: 'Rating' },
  { key: 'progress', label: 'Progress' },
];

const GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-4 gap-y-7';

function progress(b) {
  if (b.format === 'audiobook') {
    return b.duration_minutes ? (b.current_minutes ?? 0) / b.duration_minutes : 0;
  }
  return b.page_count ? (b.current_page ?? 0) / b.page_count : 0;
}

function applySort(books, sort) {
  const sorted = [...books];
  if (sort === 'title')    return sorted.sort((a, b) => a.title.localeCompare(b.title));
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
  owned:      null,
  custom:     null,
  loved:      null,
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
    (f.owned !== null ? 1 : 0) + (f.custom !== null ? 1 : 0) + (f.loved !== null ? 1 : 0);
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

function buildDisplayItems(books) {
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
        items.push({ type: 'series', name: book.series, books: mangaGroups.get(book.series) });
      }
    } else {
      items.push({ type: 'book', book });
    }
  }
  return items;
}

function sortVolumes(books) {
  return [...books].sort((a, b) =>
    (a.series_number ?? Infinity) - (b.series_number ?? Infinity) || a.title.localeCompare(b.title)
  );
}

function MangaSeriesCard({ seriesName, books, onToggle }) {
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
      className="bg-card rounded-lg p-2 pb-2.5 hover:-translate-y-0.5 transition-[transform,background-color] ease-out duration-150 text-left w-full"
    >
      <div className="relative aspect-[2/3] mb-2.5">
        {books.length >= 3 && (
          <div
            className="absolute inset-0 rounded overflow-hidden shadow ring-1 ring-white/5"
            style={{ transform: 'rotate(5deg) translate(5px, -2px)' }}
          >
            {sorted[2]?.cover_path && (
              <img src={sorted[2].cover_path} alt="" className="w-full h-full object-cover opacity-40" />
            )}
          </div>
        )}
        {books.length >= 2 && (
          <div
            className="absolute inset-0 rounded overflow-hidden shadow ring-1 ring-white/5"
            style={{ transform: 'rotate(2.5deg) translate(2px, -1px)' }}
          >
            {sorted[1]?.cover_path && (
              <img src={sorted[1].cover_path} alt="" className="w-full h-full object-cover opacity-50" />
            )}
          </div>
        )}
        <div className="absolute inset-0 rounded overflow-hidden shadow-xl ring-1 ring-white/5">
          {sorted[0]?.cover_path ? (
            <img src={sorted[0].cover_path} alt={seriesName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-end p-3 bg-gradient-to-br from-neutral-700 to-neutral-900">
              <span className="text-xs text-neutral-400 font-medium leading-tight line-clamp-4">{seriesName}</span>
            </div>
          )}
        </div>
        <div className="absolute top-1.5 right-1.5 bg-black/75 text-neutral-300 text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm leading-none">
          {books.length}
        </div>
      </div>
      <p className="text-sm font-medium text-neutral-200 truncate leading-tight">{seriesName}</p>
      {sorted[0]?.author && (
        <p className="text-xs text-neutral-500 truncate mt-0.5">{sorted[0].author}</p>
      )}
      {statusParts.length > 0 && (
        <p className="text-xs text-neutral-600 truncate mt-0.5">{statusParts.join(' · ')}</p>
      )}
    </button>
  );
}

function ExpandedSeriesSection({ seriesName, books, onToggle, onProgressUpdate }) {
  const sorted = sortVolumes(books);
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-sm font-semibold text-neutral-200 hover:text-white transition-colors"
      >
        <span>{seriesName}</span>
        <span className="text-neutral-500 font-normal text-xs">{books.length} vols</span>
        <span className="text-neutral-600 text-xs">▲</span>
      </button>
      <div className={GRID}>
        {sorted.map(book => (
          <BookCard key={book.id} book={book} onProgressUpdate={onProgressUpdate} />
        ))}
      </div>
    </div>
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

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ tab, query, filtersOpen, filters, sort }));
  }, [tab, query, filtersOpen, filters, sort]);

  useEffect(() => {
    setLoading(true);
    api.getBooks(tab === 'all' ? null : tab === 'owned' ? null : tab).then(books => {
      setBooks(books);
      setFilters(f => pruneFilters(f, books));
    }).finally(() => setLoading(false));
  }, [tab]);

  const activeCount = countFilters(filters);

  const filtered = books.filter(b => {
    if (tab === 'owned' && !b.owned) return false;

    if (query.trim() && !(
      b.title.toLowerCase().includes(query.toLowerCase()) ||
      (b.author && b.author.toLowerCase().includes(query.toLowerCase()))
    )) return false;

    if (filters.missing.length > 0 && b.is_custom) return false;
    if (filters.missing.includes('cover')     && b.cover_path)            return false;
    if (filters.missing.includes('author')    && b.author)                return false;
    if (filters.missing.includes('format')    && b.format)                return false;
    if (filters.missing.includes('isbn')      && (b.isbn_10 || b.isbn_13 || b.asin)) return false;
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
    if (filters.custom === true  && !b.is_custom) return false;
    if (filters.custom === false &&  b.is_custom) return false;
    if (filters.loved  === true  && !b.loved)     return false;
    if (filters.loved  === false &&  b.loved)     return false;

    return true;
  });

  const sortedFiltered = applySort(filtered, sort);
  const displayItems = buildDisplayItems(sortedFiltered);

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

  // Split items into grid segments, broken by expanded series
  const segments = [];
  let currentGrid = [];
  for (const item of displayItems) {
    if (item.type === 'series' && expandedSeries.has(item.name)) {
      segments.push({ type: 'grid', items: currentGrid });
      segments.push({ type: 'expanded', ...item });
      currentGrid = [];
    } else {
      currentGrid.push(item);
    }
  }
  segments.push({ type: 'grid', items: currentGrid });

  return (
    <div>
      <div className="flex flex-col gap-3 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex gap-1 bg-neutral-900 p-1 rounded-lg w-fit">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-5 py-2 text-sm rounded-md transition-[transform,background-color,color] ease-out duration-150 active:scale-[0.98] ${
                  tab === t.key
                    ? 'bg-binding/25 text-parchment font-semibold'
                    : 'font-medium text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t.label}
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
        <div className="space-y-7">
          {segments.map((seg, i) =>
            seg.type === 'expanded' ? (
              <ExpandedSeriesSection
                key={seg.name}
                seriesName={seg.name}
                books={seg.books}
                onToggle={() => toggleSeries(seg.name)}
                onProgressUpdate={handleProgressUpdate}
              />
            ) : seg.items.length > 0 ? (
              <div key={i} className={GRID}>
                {seg.items.map(item =>
                  item.type === 'series' ? (
                    <MangaSeriesCard
                      key={item.name}
                      seriesName={item.name}
                      books={item.books}
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
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
