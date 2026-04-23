import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

function formatDate(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatProgress(entry) {
  if (entry.format === 'audiobook' && entry.minutes_read > 0) {
    const h = Math.floor(entry.minutes_read / 60);
    const m = entry.minutes_read % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  if (entry.pages_read > 0) {
    return `${entry.pages_read} ${entry.pages_read === 1 ? 'page' : 'pages'}`;
  }
  return null;
}

function DiaryEntry({ entry, onDelete }) {
  const progress = formatProgress(entry);
  return (
    <div className="flex items-center gap-4 py-2.5 group">
      <div className="w-8 h-[46px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {entry.cover_path ? (
          <img src={entry.cover_path} alt={entry.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <Link
          to={`/books/${entry.book_id}`}
          className="text-sm font-medium text-neutral-200 hover:text-white transition-colors truncate block"
        >
          {entry.title}
        </Link>
        {entry.author && (
          <p className="text-xs text-neutral-500 truncate mt-0.5">{entry.author}</p>
        )}
      </div>

      {progress && (
        <span className="text-xs text-neutral-500 flex-shrink-0">{progress}</span>
      )}

      <button
        onClick={() => onDelete(entry.id)}
        className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 opacity-0 group-hover:opacity-100"
        title="Remove entry"
      >
        ×
      </button>
    </div>
  );
}

export default function Diary() {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getDiary()
      .then(setDays)
      .catch(() => setError('Failed to load diary.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(entryId, title) {
    if (!confirm(`Remove "${title}" from diary?`)) return;
    await api.deleteDiaryEntry(entryId);
    setDays(ds =>
      ds
        .map(d => ({ ...d, entries: d.entries.filter(e => e.id !== entryId) }))
        .filter(d => d.entries.length > 0)
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold text-white mb-8">Diary</h1>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div className="text-red-500 text-sm">{error}</div>
      ) : days.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">No reading logged yet.</p>
          <Link to="/" className="text-sm text-oak hover:text-leather">
            Browse your library →
          </Link>
        </div>
      ) : (() => {
        const totalPages   = days.flatMap(d => d.entries).reduce((s, e) => s + (e.pages_read || 0), 0);
        const totalMinutes = days.flatMap(d => d.entries).reduce((s, e) => s + (e.minutes_read || 0), 0);
        const parts = [];
        if (totalPages > 0)   parts.push(`${totalPages.toLocaleString()} ${totalPages === 1 ? 'page' : 'pages'}`);
        if (totalMinutes > 0) parts.push(`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m listened`);
        parts.push(`${days.length} ${days.length === 1 ? 'day' : 'days'}`);
        return (
        <div className="space-y-8">
          <p className="text-xs text-neutral-600">{parts.join(' · ')}</p>
          {days.map(day => (
            <div key={day.date}>
              <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-1 pb-2 border-b border-neutral-800">
                {formatDate(day.date)}
              </h2>
              <div className="divide-y divide-neutral-800/50">
                {day.entries.map(entry => (
                  <DiaryEntry key={entry.id} entry={entry} onDelete={id => handleDelete(id, entry.title)} />
                ))}
              </div>
            </div>
          ))}
        </div>
        );
      })()}
    </div>
  );
}
