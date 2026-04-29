import { Link } from 'react-router-dom';
import { formatAuthors } from '../../utils.js';

const STATUS_LABEL = { reading: 'Reading', paused: 'Paused', finished: 'Finished', unread: 'Unread' };
const STATUS_COLOR = {
  reading:  'text-parchment bg-oak/30',
  paused:   'text-neutral-300 bg-neutral-800',
  finished: 'text-leather bg-binding/30',
  unread:   'text-neutral-500 bg-neutral-800',
};

export default function ListRow({ book }) {
  const isAudiobook = book.format === 'audiobook';
  const pct = isAudiobook
    ? (book.duration_minutes > 0 && book.current_minutes != null ? Math.min(100, Math.round((book.current_minutes / book.duration_minutes) * 100)) : null)
    : (book.page_count > 0 && book.current_page != null ? Math.min(100, Math.round((book.current_page / book.page_count) * 100)) : null);
  const showProgress = (book.status === 'reading' || book.status === 'paused') && pct !== null;

  return (
    <Link
      to={`/books/${book.id}`}
      className="flex items-center gap-3 py-1.5 px-2 hover:bg-neutral-800/50 rounded transition-colors group"
    >
      <div className="w-6 h-9 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {book.cover_path
          ? <img src={book.cover_path} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-neutral-200 group-hover:text-white transition-colors truncate">{book.title}</p>
        {book.authors?.length > 0 && <p className="text-xs text-neutral-500 truncate">{formatAuthors(book.authors)}</p>}
        {showProgress && (
          <div className="mt-1 h-0.5 w-full bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-oak/60 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[book.status]}`}>{STATUS_LABEL[book.status]}</span>
      {showProgress && <span className="text-xs text-neutral-600 flex-shrink-0 tabular-nums w-8 text-right">{pct}%</span>}
      {!showProgress && book.format && <span className="text-xs text-neutral-600 flex-shrink-0 capitalize w-16 text-right">{book.format}</span>}
    </Link>
  );
}
