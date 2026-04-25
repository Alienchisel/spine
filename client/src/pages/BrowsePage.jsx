import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
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
};

export default function BrowsePage() {
  const { field, value } = useParams();
  const decoded = decodeURIComponent(value);
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
        return b[field] === decoded;
      });
      if (field === 'series') {
        matched.sort((a, b) => (a.series_number ?? Infinity) - (b.series_number ?? Infinity) || sortTitle(a.title).localeCompare(sortTitle(b.title)));
      } else {
        matched.sort((a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)) || (a.series_number ?? Infinity) - (b.series_number ?? Infinity));
      }
      setBooks(matched);
    }).finally(() => setLoading(false));
  }, [field, decoded]);

  const label = FIELD_LABEL[field] ?? field;
  const heading = field === 'fiction'
    ? (decoded === 'fiction' ? 'Fiction' : decoded === 'nonfiction' ? 'Non-fiction' : 'Fiction / NF unset')
    : decoded;

  return (
    <div>
      <Link to="/" className="text-sm text-neutral-600 hover:text-neutral-300 mb-8 inline-block transition-colors">
        ← Library
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
