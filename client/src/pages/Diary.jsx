import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatAuthors } from '../utils.js';

function formatDate(dateStr) {
  const today = new Date().toLocaleDateString('en-CA');
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = y.toLocaleDateString('en-CA');
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

const READ_DAY_CLASS = 'bg-oak/40 text-parchment';

function formatMinutes(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function formatDayShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

function formatTotal({ pages, minutes }) {
  const parts = [];
  if (pages > 0)   parts.push(`${pages.toLocaleString()} ${pages === 1 ? 'page' : 'pages'}`);
  if (minutes > 0) parts.push(formatMinutes(minutes));
  return parts.join(' · ') || '—';
}

function ReadingCalendar({ days, selectedYear, onDayClick }) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const todayStr = today.toLocaleDateString('en-CA');

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

  const minutesByDate = useMemo(() => {
    const map = {};
    for (const day of days) map[day.date] = day.entries.reduce((s, e) => s + (e.minutes_read || 0), 0);
    return map;
  }, [days]);

  const readingDates = useMemo(() => new Set(days.map(d => d.date)), [days]);

  const totals = useMemo(() => {
    const todayDate = new Date();
    const dow = todayDate.getDay() || 7;
    const monday = new Date(todayDate);
    monday.setDate(todayDate.getDate() - (dow - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const mondayStr = monday.toLocaleDateString('en-CA');
    const sundayStr = sunday.toLocaleDateString('en-CA');
    // All three totals are "now"-relative — they don't follow calendar nav.
    // Calendar prev/next is purely a visual browser; week/month/year reflect
    // the current real date. (Year still follows the selectedYear dropdown
    // because that's the explicit data-loading control.)
    const monthPrefix = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}`;
    const yearPrefix  = String(selectedYear);

    const acc = {
      week:  { pages: 0, minutes: 0 },
      month: { pages: 0, minutes: 0 },
      year:  { pages: 0, minutes: 0 },
    };
    for (const d of days) {
      let p = 0, m = 0;
      for (const e of d.entries) { p += e.pages_read || 0; m += e.minutes_read || 0; }
      if (d.date >= mondayStr && d.date <= sundayStr) { acc.week.pages  += p; acc.week.minutes  += m; }
      if (d.date.startsWith(monthPrefix))             { acc.month.pages += p; acc.month.minutes += m; }
      if (d.date.startsWith(yearPrefix))              { acc.year.pages  += p; acc.year.minutes  += m; }
    }
    return acc;
  }, [days, selectedYear]);

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
      <div className="space-y-1 mb-5 text-xs">
        {[
          { label: 'This week',  total: totals.week  },
          { label: 'This month', total: totals.month },
          { label: 'This year',  total: totals.year  },
        ].map(({ label, total }) => (
          <div key={label} className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</span>
            <span className="tabular-nums text-neutral-300">{formatTotal(total)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} disabled={atStart} className="text-neutral-600 hover:text-neutral-300 transition-colors w-6 text-center disabled:opacity-20">‹</button>
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{monthLabel}</span>
        <button onClick={nextMonth} disabled={atEnd}  className="text-neutral-600 hover:text-neutral-300 transition-colors w-6 text-center disabled:opacity-20">›</button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map((h, i) => <div key={i} className="text-center text-xs text-neutral-500 py-0.5">{h}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {Array.from({ length: totalCells }, (_, i) => {
          const dateStr = cellDateStr(i);
          if (!dateStr) return <div key={i} />;
          const pages    = pagesByDate[dateStr] || 0;
          const minutes  = minutesByDate[dateStr] || 0;
          const hasEntry = readingDates.has(dateStr);
          const isFuture = dateStr > todayStr;
          const isToday  = dateStr === todayStr;
          const tipParts = [pages > 0 && `${pages}p`, minutes > 0 && `${minutes}m`].filter(Boolean);
          // Merge consecutive read days within the same row by squaring inner edges.
          // col 0 = Monday, col 6 = Sunday — bands can't span across rows.
          const col = i % 7;
          const prevIsRead = hasEntry && col > 0 && readingDates.has(cellDateStr(i - 1));
          const nextIsRead = hasEntry && col < 6 && readingDates.has(cellDateStr(i + 1));
          const radiusClass = !hasEntry        ? 'rounded'
                            : prevIsRead && nextIsRead ? ''
                            : prevIsRead       ? 'rounded-r'
                            : nextIsRead       ? 'rounded-l'
                            :                    'rounded';
          return (
            <div
              key={dateStr}
              onClick={() => hasEntry && onDayClick(dateStr)}
              title={hasEntry ? tipParts.join(' · ') : undefined}
              className={[
                'flex items-center justify-center text-xs h-7 select-none',
                radiusClass,
                isFuture ? 'text-neutral-800' : hasEntry ? `${READ_DAY_CLASS} cursor-pointer hover:ring-1 hover:ring-oak/50` : 'text-neutral-700',
              ].join(' ')}
            >
              <span className={isToday ? 'underline underline-offset-2' : ''}>
                {parseInt(dateStr.slice(-2))}
              </span>
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
        {entry.authors?.length > 0 && <p className="text-xs text-neutral-500 truncate mt-0.5">{formatAuthors(entry.authors)}</p>}
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
  const [stats,   setStats]   = useState({ dayStreak: 0, dayStreakBest: 0, dayStreakSince: null, dayStreakBestStart: null, dayStreakBestEnd: null, weekStreak: 0, weekStreakBest: 0 });
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [deleteError, setDeleteError] = useState(null);
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
    try {
      await api.deleteDiaryEntry(entryId);
      setDays(ds => ds.map(d => ({ ...d, entries: d.entries.filter(e => e.id !== entryId) })).filter(d => d.entries.length > 0));
    } catch {
      setDeleteError('Failed to remove entry.');
    }
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
          <p className="text-neutral-600 mb-3">No reading logged{years.length > 0 ? ` in ${year}` : ' yet'}.</p>
          {years.length === 0 && (
            <Link to="/" className="text-sm text-oak hover:text-leather">Browse your library →</Link>
          )}
        </div>
      ) : (
        <div>
          {deleteError && (
            <div className="flex items-center justify-between bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-2 mb-4 text-xs text-red-400">
              {deleteError}
              <button onClick={() => setDeleteError(null)} className="ml-4 text-red-600 hover:text-red-400">×</button>
            </div>
          )}
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
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-3 pb-2 border-b border-neutral-700/60">Overview</p>
              <div className="space-y-1 mb-1 text-xs">
                <div
                  className="flex items-baseline justify-between"
                  title={[
                    stats.dayStreak > 0 && stats.dayStreakSince  && `Current: since ${formatDayShort(stats.dayStreakSince)}`,
                    stats.dayStreakBest > 0 && stats.dayStreakBestStart && `Best: ${formatDayShort(stats.dayStreakBestStart)} – ${formatDayShort(stats.dayStreakBestEnd)}`,
                  ].filter(Boolean).join('\n') || undefined}
                >
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">Day streak</span>
                  <span className="tabular-nums text-neutral-300">
                    {stats.dayStreak}
                    {stats.dayStreakBest > stats.dayStreak && (
                      <span className="text-neutral-600 ml-1.5">(best {stats.dayStreakBest})</span>
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">Week streak</span>
                  <span className="tabular-nums text-neutral-300">
                    {stats.weekStreak}
                    {stats.weekStreakBest > stats.weekStreak && (
                      <span className="text-neutral-600 ml-1.5">(best {stats.weekStreakBest})</span>
                    )}
                  </span>
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
