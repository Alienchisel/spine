import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatAuthors, fmtShortDate } from '../utils.js';
import { useConfirm } from '../components/ConfirmModal.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

const FROM_DIARY = { from: 'Diary', fromPath: '/diary' };

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

function formatTotal({ pages, minutes }) {
  const parts = [];
  if (pages > 0)   parts.push(`${pages.toLocaleString()} ${pages === 1 ? 'page' : 'pages'}`);
  if (minutes > 0) parts.push(formatMinutes(minutes));
  return parts.join(' · ') || '—';
}

function ReadingCalendar({ days, selectedYear, totals, onDayClick }) {
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

  // Tooltip ranges for the now-relative totals. Anchor weeks Mon–Sun, matching
  // the SQL in routes/diary.js. Re-computed only on mount; the diary doesn't
  // span midnight, so re-rendering across day boundaries isn't a real concern.
  const tooltipRanges = useMemo(() => {
    const dow    = today.getDay() || 7;
    const monday = new Date(today); monday.setDate(today.getDate() - (dow - 1));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const dayMo  = { day: 'numeric', month: 'short' };
    const dayMoY = { day: 'numeric', month: 'short', year: 'numeric' };
    return {
      week:  `${monday.toLocaleDateString('en-GB', dayMo)} – ${sunday.toLocaleDateString('en-GB', dayMoY)}`,
      month: today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      year:  String(today.getFullYear()),
    };
  }, []);

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
          { label: 'This week',  total: totals.week,  range: tooltipRanges.week  },
          { label: 'This month', total: totals.month, range: tooltipRanges.month },
          { label: 'This year',  total: totals.year,  range: tooltipRanges.year  },
        ].map(({ label, total, range }) => (
          <div key={label} className="flex items-baseline justify-between" title={range}>
            <span className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</span>
            <span className="tabular-nums text-neutral-300">{formatTotal(total)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} disabled={atStart} aria-label="Previous month" className="text-neutral-600 hover:text-neutral-300 transition-colors w-6 text-center disabled:opacity-20">‹</button>
        <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{monthLabel}</span>
        <button onClick={nextMonth} disabled={atEnd}  aria-label="Next month"     className="text-neutral-600 hover:text-neutral-300 transition-colors w-6 text-center disabled:opacity-20">›</button>
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
          // Read days render as buttons so keyboard users can Tab to them
          // and Enter to jump to the diary entry. Non-read days stay as
          // plain divs — they're date labels with no action attached, so
          // adding them to the tab order would just be noise.
          const cellClass = [
            'flex items-center justify-center text-xs h-7 select-none',
            radiusClass,
            isFuture ? 'text-neutral-800' : hasEntry ? `${READ_DAY_CLASS} cursor-pointer hover:ring-1 hover:ring-oak/50` : 'text-neutral-700',
          ].join(' ');
          const inner = (
            <span className={isToday ? 'underline underline-offset-2' : ''}>
              {parseInt(dateStr.slice(-2))}
            </span>
          );
          return hasEntry ? (
            <button
              key={dateStr}
              type="button"
              onClick={() => onDayClick(dateStr)}
              title={tipParts.join(' · ')}
              className={cellClass}
            >
              {inner}
            </button>
          ) : (
            <div key={dateStr} className={cellClass}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}

function DiaryEntry({ entry, onDelete }) {
  const progress = formatProgress(entry);
  // Story-attributed rows surface the story title in the primary slot
  // and demote the parent book title into the subline beside the
  // authors. Book-level rows render the book title as before.
  const isStory = !!entry.story_title;
  const primary = isStory ? entry.story_title : entry.title;
  const subParts = [];
  if (isStory) subParts.push(entry.title);
  if (entry.authors?.length > 0) subParts.push(formatAuthors(entry.authors));
  return (
    <div className="flex items-center gap-4 py-2.5 group">
      <div className="w-8 h-[46px] flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {entry.cover_path
          ? <img src={entry.cover_path} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
      </div>
      <div className="flex-1 min-w-0">
        <Link to={`/books/${entry.book_id}`} state={FROM_DIARY} className="text-sm font-medium text-neutral-200 hover:text-white transition-colors truncate block" title={primary}>
          {isStory ? <>&ldquo;{primary}&rdquo;</> : primary}
        </Link>
        {subParts.length > 0 && <p className="text-xs text-neutral-500 truncate mt-0.5">{subParts.join(' · ')}</p>}
      </div>
      {progress && <span className="text-xs text-neutral-500 flex-shrink-0">{progress}</span>}
      <button
        onClick={() => onDelete(entry.id)}
        className="text-neutral-700 hover:text-red-400 transition-colors text-lg leading-none flex-shrink-0 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100"
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
  const [stats,   setStats]   = useState({
    dayStreak: 0, dayStreakBest: 0, dayStreakSince: null, dayStreakBestStart: null, dayStreakBestEnd: null,
    weekStreak: 0, weekStreakBest: 0,
    thisWeek:  { pages: 0, minutes: 0 },
    thisMonth: { pages: 0, minutes: 0 },
    thisYear:  { pages: 0, minutes: 0 },
  });
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const dayRefs = useRef({});
  // Stale-response guard for getDiary on year change. Quick clicking
  // through years could otherwise let an older year's response clobber
  // the displayed days/years/stats for a newly-selected year.
  const yearGenRef = useRef(0);
  // Tracks diary entry ids whose delete is in flight. The confirm modal
  // cancels overlapping confirms, but a re-click *after* confirming —
  // while the API call is pending and setDays hasn't yet removed the row
  // — fires a duplicate deleteDiaryEntry that 404s on the second attempt
  // and surfaces "Failed to remove entry." over a row that did delete.
  // Mirrors the deletingIdsRef pattern in ReadsSection.
  const deletingEntryIdsRef = useRef(new Set());
  const confirm = useConfirm();
  const refreshTick = useRefreshTick();

  useEffect(() => {
    const gen = ++yearGenRef.current;
    setLoading(true);
    // Reset prior load/delete errors so a stale message from one year doesn't
    // hang on top of another year's freshly-loaded entries.
    setError(null);
    setDeleteError(null);
    api.getDiary(year)
      .then(({ days: d, years: ys, stats: s }) => {
        if (gen !== yearGenRef.current) return;
        setDays(d);
        setYears(ys);
        setStats(s);
      })
      .catch(() => { if (gen === yearGenRef.current) setError('Failed to load diary.'); })
      .finally(() => { if (gen === yearGenRef.current) setLoading(false); });
  }, [year, refreshTick]);

  async function handleDelete(entryId, title) {
    if (deletingEntryIdsRef.current.has(entryId)) return;
    if (!await confirm(`Remove "${title}" from diary?`)) return;
    if (deletingEntryIdsRef.current.has(entryId)) return;
    deletingEntryIdsRef.current.add(entryId);
    setDeleteError(null);
    try {
      await api.deleteDiaryEntry(entryId);
      setDays(ds => ds.map(d => ({ ...d, entries: d.entries.filter(e => e.id !== entryId) })).filter(d => d.entries.length > 0));
    } catch {
      setDeleteError('Failed to remove entry.');
    } finally {
      deletingEntryIdsRef.current.delete(entryId);
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
        <div role="alert" className="text-red-500 text-sm">{error}</div>
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
            <div role="alert" className="flex items-center justify-between bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-2 mb-4 text-xs text-red-400">
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
                      <DiaryEntry key={entry.id} entry={entry} onDelete={id => handleDelete(id, entry.story_title || entry.title)} />
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
                    stats.dayStreak > 0 && stats.dayStreakSince  && `Current: since ${fmtShortDate(stats.dayStreakSince)}`,
                    stats.dayStreakBest > 0 && stats.dayStreakBestStart && `Best: ${fmtShortDate(stats.dayStreakBestStart)} – ${fmtShortDate(stats.dayStreakBestEnd)}`,
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
                totals={{ week: stats.thisWeek, month: stats.thisMonth, year: stats.thisYear }}
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
