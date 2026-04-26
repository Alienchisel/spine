import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

function formatDate(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatProgress(entry) {
  if (entry.format === 'audiobook' && entry.minutes_read > 0) {
    const h = Math.floor(entry.minutes_read / 60);
    const m = entry.minutes_read % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  if (entry.pages_read > 0) return `${entry.pages_read} ${entry.pages_read === 1 ? 'page' : 'pages'}`;
  return null;
}

const DAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function intensityClass(pages) {
  if (pages >= 100) return 'bg-oak/80 text-parchment';
  if (pages >= 50)  return 'bg-oak/55 text-parchment';
  if (pages >= 20)  return 'bg-oak/35 text-neutral-200';
  return 'bg-oak/20 text-neutral-300';
}

function ReadingCalendar({ days, selectedYear, onDayClick }) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const todayStr = today.toISOString().slice(0, 10);

  const [viewYear,  setViewYear]  = useState(selectedYear);
  const [viewMonth, setViewMonth] = useState(
    selectedYear === currentYear ? today.getMonth() : 11
  );

  useEffect(() => {
    setViewYear(selectedYear);
    setViewMonth(selectedYear === currentYear ? today.getMonth() : 11);
  }, [selectedYear]);

  const pagesByDate = useMemo(() => {
    const map = {};
    for (const day of days) map[day.date] = day.entries.reduce((s, e) => s + (e.pages_read || 0), 0);
    return map;
  }, [days]);

  const readingDates = useMemo(() => new Set(days.map(d => d.date)), [days]);

  const firstDow   = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = (firstDow + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells  = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const monthLabel  = new Date(viewYear, viewMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const atStart = viewYear === selectedYear && viewMonth === 0;
  const atEnd   = selectedYear === currentYear
    ? (viewYear === currentYear && viewMonth === today.getMonth())
    : (viewYear === selectedYear && viewMonth === 11);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function cellDateStr(i) {
    const d = i - startOffset + 1;
    if (d < 1 || d > daysInMonth) return null;
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} disabled={atStart} className="text-neutral-600 hover:text-neutral-300 transition-colors w-6 text-center disabled:opacity-20">‹</button>
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{monthLabel}</span>
        <button onClick={nextMonth} disabled={atEnd}  className="text-neutral-600 hover:text-neutral-300 transition-colors w-6 text-center disabled:opacity-20">›</button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map((h, i) => <div key={i} className="text-center text-xs text-neutral-700 py-0.5">{h}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: totalCells }, (_, i) => {
          const dateStr = cellDateStr(i);
          if (!dateStr) return <div key={i} />;
          const pages    = pagesByDate[dateStr] || 0;
          const hasEntry = readingDates.has(dateStr);
          const isFuture = dateStr > todayStr;
          const isToday  = dateStr === todayStr;
          return (
            <div
              key={dateStr}
              onClick={() => hasEntry && onDayClick(dateStr)}
              title={hasEntry ? `${pages} pages` : undefined}
              className={[
                'flex items-center justify-center rounded text-xs h-7 select-none',
                isFuture ? 'text-neutral-800' : hasEntry ? `${intensityClass(pages)} cursor-pointer hover:ring-1 hover:ring-oak/50` : 'text-neutral-700 bg-neutral-800/40',
                isToday ? 'ring-1 ring-neutral-600' : '',
              ].join(' ')}
            >
              {parseInt(dateStr.slice(-2))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiaryEntry({ entry, onDelete }) {
  const progress = formatProgress(entry);
  return (
    <div className="flex items-center gap-4 py-2.5 group">
      <div className="w-8 h-[46px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {entry.cover_path
          ? <img src={entry.cover_path} alt={entry.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
      </div>
      <div className="flex-1 min-w-0">
        <Link to={`/books/${entry.book_id}`} className="text-sm font-medium text-neutral-200 hover:text-white transition-colors truncate block" title={entry.title}>
          {entry.title}
        </Link>
        {entry.author && <p className="text-xs text-neutral-500 truncate mt-0.5">{entry.author}</p>}
      </div>
      {progress && <span className="text-xs text-neutral-500 flex-shrink-0">{progress}</span>}
      <button
        onClick={() => onDelete(entry.id)}
        className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 opacity-0 group-hover:opacity-100"
        title="Remove entry"
      >×</button>
    </div>
  );
}

const CURRENT_YEAR = new Date().getFullYear();

export default function Diary() {
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [days,    setDays]    = useState([]);
  const [years,   setYears]   = useState([]);
  const [stats,   setStats]   = useState({ dayStreak: 0, weekStreak: 0 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const dayRefs = useRef({});

  useEffect(() => {
    setLoading(true);
    api.getDiary(year)
      .then(({ days: d, years: ys, stats: s }) => {
        setDays(d);
        setYears(ys);
        setStats(s);
      })
      .catch(() => setError('Failed to load diary.'))
      .finally(() => setLoading(false));
  }, [year]);

  async function handleDelete(entryId, title) {
    if (!confirm(`Remove "${title}" from diary?`)) return;
    await api.deleteDiaryEntry(entryId);
    setDays(ds => ds.map(d => ({ ...d, entries: d.entries.filter(e => e.id !== entryId) })).filter(d => d.entries.length > 0));
  }

  const totalPages   = days.flatMap(d => d.entries).reduce((s, e) => s + (e.pages_read   || 0), 0);
  const totalMinutes = days.flatMap(d => d.entries).reduce((s, e) => s + (e.minutes_read || 0), 0);

  const summaryParts = [];
  if (totalPages   > 0) summaryParts.push(`${totalPages.toLocaleString()} ${totalPages === 1 ? 'page' : 'pages'}`);
  if (totalMinutes > 0) summaryParts.push(`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m listened`);
  if (days.length  > 0) summaryParts.push(`${days.length} ${days.length === 1 ? 'day' : 'days'}`);
  if (stats.dayStreak > 1) summaryParts.push(`${stats.dayStreak}-day streak`);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-8">
        <h1 className="text-xl font-bold text-white">Diary</h1>
        {years.length > 1 && (
          <select
            value={year}
            onChange={e => setYear(parseInt(e.target.value))}
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-300 focus:outline-none focus:border-oak/50 transition-colors"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div className="text-neutral-700 text-sm">Loading…</div>
      ) : error ? (
        <div className="text-red-500 text-sm">{error}</div>
      ) : days.length === 0 ? (
        <div className="text-center py-32">
          <p className="text-neutral-600 mb-3">No reading logged{years.length > 0 ? ` in ${year}` : ' yet'}.{years.length > 0 && year === CURRENT_YEAR && years[0] !== CURRENT_YEAR ? '' : ''}</p>
          {years.length === 0 && (
            <Link to="/" className="text-sm text-oak hover:text-leather">Browse your library →</Link>
          )}
        </div>
      ) : (
        <div>
          {summaryParts.length > 0 && (
            <p className="text-xs text-neutral-600 mb-6">{summaryParts.join(' · ')}</p>
          )}
          <div className="flex gap-10 items-start">
            <div className="flex-1 min-w-0 space-y-8">
              {days.map(day => (
                <div key={day.date} ref={el => { if (el) dayRefs.current[day.date] = el; }}>
                  <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-1 pb-2 border-b border-neutral-800 flex justify-between items-baseline">
                    <span>{formatDate(day.date)}</span>
                    <span className="text-neutral-700 normal-case tracking-normal font-normal">
                      {(() => {
                        const p = day.entries.reduce((s, e) => s + (e.pages_read   || 0), 0);
                        const m = day.entries.reduce((s, e) => s + (e.minutes_read || 0), 0);
                        const parts = [];
                        if (p > 0) parts.push(`${p} ${p === 1 ? 'page' : 'pages'}`);
                        if (m > 0) parts.push(`${Math.floor(m / 60)}h ${m % 60}m`);
                        return parts.join(' · ');
                      })()}
                    </span>
                  </h2>
                  <div className="divide-y divide-neutral-800/50">
                    {day.entries.map(entry => (
                      <DiaryEntry key={entry.id} entry={entry} onDelete={id => handleDelete(id, entry.title)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="w-64 flex-shrink-0 sticky top-20 bg-neutral-800 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-neutral-900 rounded-lg p-3 text-center">
                  <p className="text-xs text-neutral-500 mb-1.5">Days in a row</p>
                  <p className="text-2xl font-semibold text-parchment">{stats.dayStreak}</p>
                </div>
                <div className="bg-neutral-900 rounded-lg p-3 text-center">
                  <p className="text-xs text-neutral-500 mb-1.5">Weeks in a row</p>
                  <p className="text-2xl font-semibold text-parchment">{stats.weekStreak}</p>
                </div>
              </div>
              <ReadingCalendar
                days={days}
                selectedYear={year}
                onDayClick={dateStr => {
                  const el = dayRefs.current[dateStr];
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
