import { useState, useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { sortTitle } from '../utils.js';
import BookCard from '../components/BookCard.jsx';

const FIELD_LABEL = {
  author: 'Author',
  translator: 'Translator',
  publisher: 'Publisher',
  series: 'Series',
  tag: 'Tag',
  fiction: '',
  format: '',
  language: 'Language',
  narrator: 'Narrator',
  rating: 'Rating',
  year_finished: 'Finished',
};

const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

function starsLabel(r) {
  const full = Math.floor(r);
  const half = r % 1 !== 0;
  return '★'.repeat(full) + (half ? '½' : '');
}

export default function BrowsePage() {
  const { field, value } = useParams();
  const decoded = decodeURIComponent(value);
  const { state } = useLocation();
  const backLabel = state?.from ? `← ${state.from}` : '← Library';
  const backPath  = state?.fromPath ?? '/';
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBooks().then(all => {
      const matched = all.filter(b => {
        if (field === 'tag') return b.tags?.some(t => t.name === decoded);
        if (field === 'fiction') {
          if (decoded === 'fiction')    return b.fiction === 1;
          if (decoded === 'nonfiction') return b.fiction === 0;
          if (decoded === 'unset')      return b.fiction === null || b.fiction === undefined;
        }
        if (field === 'rating')        return b.rating === parseFloat(decoded);
        if (field === 'year_finished') return b.date_finished?.startsWith(decoded);
        return b[field] === decoded;
      });
      if (field === 'series') {
        matched.sort((a, b) => (a.series_number ?? Infinity) - (b.series_number ?? Infinity) || sortTitle(a.title).localeCompare(sortTitle(b.title)));
      } else if (field === 'year_finished') {
        matched.sort((a, b) => (a.date_finished || '').localeCompare(b.date_finished || ''));
      } else {
        matched.sort((a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)) || (a.series_number ?? Infinity) - (b.series_number ?? Infinity));
      }
      setBooks(matched);
    }).finally(() => setLoading(false));
  }, [field, decoded]);

  const label = FIELD_LABEL[field] ?? field;
  const heading = field === 'fiction'
    ? (decoded === 'fiction' ? 'Fiction' : decoded === 'nonfiction' ? 'Non-fiction' : 'Fiction / NF unset')
    : field === 'format'       ? (FORMAT_LABEL[decoded] ?? decoded)
    : field === 'rating'       ? starsLabel(parseFloat(decoded))
    : field === 'year_finished' ? decoded
    : decoded;

  return (
    <div>
      <Link to={backPath} className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        {backLabel}
      </Link>
      <div className="mb-8">
        {label && <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1">{label}</p>}
        <h1 className="text-2xl font-bold text-white">{heading}</h1>
        {!loading && <p className="text-sm text-neutral-500 mt-1">{books.length} {books.length === 1 ? 'book' : 'books'}</p>}
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : books.length === 0 ? (
        <div className="text-neutral-600 text-sm">No books found.</div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-7">
          {books.map(book => <BookCard key={book.id} book={book} />)}
        </div>
      )}
    </div>
  );
}
