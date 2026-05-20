import { Fragment, useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatAuthors, fmtShortDate, plural, pluralWord, initialsFor } from '../utils.js';
import { useConfirm } from '../components/ConfirmModal.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import { useStaleGuard } from '../hooks/useStaleGuard.js';

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
  if (entry.pages_read > 0) return plural(entry.pages_read, 'page');
  return null;
}

const DAY_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const READ_DAY_CLASS = 'bg-oak/40 text-parchment';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HEATMAP_LEVEL_CLASS = [
  'bg-neutral-800/60',  // 0: no reading
  'bg-oak/20',          // 1
  'bg-oak/45',          // 2
  'bg-oak/70',          // 3
  'bg-oak',             // 4
];

function formatMinutes(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function formatTotal({ pages, minutes }) {
  const parts = [];
  if (pages > 0)   parts.push(`${pages.toLocaleString()} ${pluralWord(pages, 'page')}`);
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
          // Spell-out tooltip — "23 pages · 2h 10m" reads as natural prose
          // (the prior "23p · 45m" was code shorthand). Minutes follow the
          // diary's day-header format (Xh Ym), collapsing the 0h prefix
          // for under-an-hour values so it reads as "45m" not "0h 45m".
          const fmtMin = (m) => {
            const h = Math.floor(m / 60);
            const mm = m % 60;
            if (h === 0)  return `${mm}m`;
            if (mm === 0) return `${h}h`;
            return `${h}h ${mm}m`;
          };
          const tipParts = [
            pages > 0   && plural(pages, 'page'),
            minutes > 0 && fmtMin(minutes),
          ].filter(Boolean);
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
            // aspect-square ties cell height to its grid-derived width
            // so the calendar reads as a contribution-graph heatmap
            // (the intensity colour is the primary signal) rather than
            // a date-grid of rectangles.
            'flex items-center justify-center text-xs aspect-square select-none',
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

// Year-at-a-glance heatmap, vertical orientation. ~53 rows (weeks)
// × 7 columns (days, Mon–Sun) — reads top-to-bottom through the year.
// Lives in a narrow sidebar beside the entries list. Cells with
// reading are clickable; on click, the parent scrolls to that day.
// Intensity scales by percentile of the user's own active days so
// casual and heavy readers both get a useful range of shades.
function YearHeatmap({ days, selectedYear, onDayClick }) {
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA');

  // Per-day activity. Score combines pages + minutes/2 only for
  // intensity bucketing — the tooltip shows raw pages / minutes.
  const activityByDate = useMemo(() => {
    const map = {};
    for (const day of days) {
      const p = day.entries.reduce((s, e) => s + (e.pages_read   || 0), 0);
      const m = day.entries.reduce((s, e) => s + (e.minutes_read || 0), 0);
      map[day.date] = { pages: p, minutes: m, score: p + m / 2 };
    }
    return map;
  }, [days]);

  // Percentile-bucketed thresholds across non-zero days. A single hot
  // outlier won't flatten everything to level 1.
  const thresholds = useMemo(() => {
    const scores = Object.values(activityByDate).map(a => a.score).filter(s => s > 0).sort((a, b) => a - b);
    if (scores.length === 0) return [0, 0, 0];
    const q = (p) => scores[Math.min(scores.length - 1, Math.floor(scores.length * p))];
    return [q(0.25), q(0.50), q(0.75)];
  }, [activityByDate]);

  function intensity(score) {
    if (!score) return 0;
    if (score < thresholds[0]) return 1;
    if (score < thresholds[1]) return 2;
    if (score < thresholds[2]) return 3;
    return 4;
  }

  // Build a flat list of dates from the Monday of the week containing
  // Jan 1 through the Sunday of the week containing Dec 31. Grouped
  // into weeks (rows) of 7 dates each.
  const weeks = useMemo(() => {
    const yearStart = new Date(selectedYear, 0, 1);
    const yearEnd   = new Date(selectedYear, 11, 31);
    const startDow  = (yearStart.getDay() + 6) % 7; // 0 = Monday
    const endDow    = (yearEnd.getDay()   + 6) % 7;
    const gridStart = new Date(yearStart); gridStart.setDate(yearStart.getDate() - startDow);
    const gridEnd   = new Date(yearEnd);   gridEnd.setDate(yearEnd.getDate() + (6 - endDow));
    const all = [];
    const cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      all.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    const rows = [];
    for (let i = 0; i < all.length; i += 7) rows.push(all.slice(i, i + 7));
    return rows;
  }, [selectedYear]);

  // Month label for a row = the month of the 1st-of-the-month day if
  // any of the row's days is the 1st. Renders in the row's label slot.
  function rowMonthLabel(week) {
    for (const d of week) {
      if (d.getDate() === 1 && d.getFullYear() === selectedYear) {
        return MONTH_LABELS[d.getMonth()];
      }
    }
    return '';
  }

  const fmtMin = (m) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0)  return `${mm}m`;
    if (mm === 0) return `${h}h`;
    return `${h}h ${mm}m`;
  };

  // Split the year into two halves (Jan–Jun on the left, Jul–Dec on
  // the right) so the heatmap fits in roughly half the vertical
  // space. Boundary weeks (last week of June bleeding into July) are
  // assigned to the half whose Monday they belong to. The right half
  // can start with an aligned-row by-day, since each half renders its
  // own independent grid.
  const halves = useMemo(() => {
    const left  = weeks.filter(w => w[0].getMonth() < 6 || w[0].getFullYear() < selectedYear);
    const right = weeks.filter(w => !(w[0].getMonth() < 6 || w[0].getFullYear() < selectedYear));
    return [left, right];
  }, [weeks, selectedYear]);

  function renderHalf(halfWeeks, key) {
    return (
      <div
        key={key}
        className="grid gap-[3px] flex-1 min-w-0"
        style={{ gridTemplateColumns: 'auto repeat(7, minmax(0, 1fr))' }}
      >
        <div />
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} className="text-[9px] text-neutral-500 text-center leading-3">{d}</div>
        ))}
        {halfWeeks.map((week, wIdx) => (
          <Fragment key={wIdx}>
            <div className="text-[9px] text-neutral-500 leading-3 pr-1 flex items-center justify-end min-w-[18px]">
              {rowMonthLabel(week)}
            </div>
            {week.map((d, dIdx) => {
              const dateStr = d.toLocaleDateString('en-CA');
              const inYear  = d.getFullYear() === selectedYear;
              const future  = dateStr > todayStr;
              const act     = activityByDate[dateStr];
              const level   = inYear && !future && act ? intensity(act.score) : 0;
              const out     = inYear && !future;
              const cls     = [
                'aspect-square rounded-sm',
                out ? HEATMAP_LEVEL_CLASS[level] : 'bg-transparent',
                act && act.score > 0 ? 'cursor-pointer hover:ring-1 hover:ring-oak/60' : '',
              ].join(' ');
              const tip = out
                ? [
                    formatDate(dateStr),
                    act && act.pages > 0   && plural(act.pages, 'page'),
                    act && act.minutes > 0 && fmtMin(act.minutes),
                  ].filter(Boolean).join(' · ')
                : null;
              return act && act.score > 0 ? (
                <button
                  key={dIdx}
                  type="button"
                  onClick={() => onDayClick(dateStr)}
                  title={tip}
                  className={cls}
                  aria-label={tip ?? dateStr}
                />
              ) : (
                <div key={dIdx} className={cls} title={tip ?? undefined} />
              );
            })}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-neutral-800 rounded-xl p-4">
      <div className="flex gap-3 items-start">
        {renderHalf(halves[0], 'h1')}
        {renderHalf(halves[1], 'h2')}
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
          : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-center justify-center text-[10px] text-neutral-500 font-medium tracking-wide">{initialsFor(entry.title)}</div>}
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
  const guard = useStaleGuard();
  // Tracks diary entry ids whose delete is in flight. The confirm modal
  // cancels overlapping confirms, but a re-click *after* confirming —
  // while the API call is pending and setDays hasn't yet removed the row
  // — fires a duplicate deleteDiaryEntry that 404s on the second attempt
  // and surfaces "Failed to remove entry." over a row that did delete.
  // Mirrors the deletingIdsRef pattern in ReadsSection.
  const deletingEntryIdsRef = useRef(new Set());
  const confirm = useConfirm();
  const refreshTick = useRefreshTick();
  // Snapshot of the diary-fetch year so we can distinguish a year
  // change from a refresh-tick refetch. On a same-year refetch we
  // keep the rendered days visible during the fetch — otherwise
  // setLoading(true) flips the render to 'Loading…' and the user's
  // scroll position is lost when content briefly collapses.
  const lastYearRef = useRef(null);

  useEffect(() => {
    const epoch = guard.next();
    const isSameYear = year === lastYearRef.current;
    lastYearRef.current = year;
    // Real year change: wipe to a loading state so stale days don't
    // show under a new year. refreshTick refetch at the same year:
    // keep days visible during the fetch so scroll position survives.
    if (!isSameYear) setLoading(true);
    // Reset prior load/delete errors so a stale message from one year doesn't
    // hang on top of another year's freshly-loaded entries.
    setError(null);
    setDeleteError(null);
    api.getDiary(year)
      .then(({ days: d, years: ys, stats: s }) => {
        if (!guard.isFresh(epoch)) return;
        setDays(d);
        setYears(ys);
        setStats(s);
      })
      .catch(() => { if (guard.isFresh(epoch)) setError('Failed to load diary.'); })
      .finally(() => { if (guard.isFresh(epoch)) setLoading(false); });
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

  return (
    <div className="max-w-5xl">
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

      {/* First-load failure (no data ever loaded) replaces the view; a
          refresh-tick failure on an already-loaded year surfaces as a
          dismissible inline banner alongside the existing days. Same
          shape as ShelfView's error banner. */}
      {days.length > 0 && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {loading ? (
        <div role="status" className="text-neutral-700 text-sm">Loading…</div>
      ) : days.length === 0 && error ? (
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
          {/* Side-by-side layout: entries on the left, vertical
              year heatmap on the right. The heatmap is tall (~53
              weeks) and stays sticky so it follows the user as they
              scroll through the entries. Stats sit inside the heatmap
              card above the grid. */}
          <div className="flex gap-12 items-start">
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
                        if (p > 0) parts.push(plural(p, 'page'));
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

            <div className="w-[28rem] flex-shrink-0 sticky top-20 space-y-3">
              <div className="bg-neutral-800 rounded-xl p-4 space-y-1 text-xs">
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
                      <span className="text-neutral-600 ml-1">(best {stats.dayStreakBest})</span>
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">Week streak</span>
                  <span className="tabular-nums text-neutral-300">
                    {stats.weekStreak}
                    {stats.weekStreakBest > stats.weekStreak && (
                      <span className="text-neutral-600 ml-1">(best {stats.weekStreakBest})</span>
                    )}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">This week</span>
                  <span className="tabular-nums text-neutral-300">{formatTotal(stats.thisWeek)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">This month</span>
                  <span className="tabular-nums text-neutral-300">{formatTotal(stats.thisMonth)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-600">This year</span>
                  <span className="tabular-nums text-neutral-300">{formatTotal(stats.thisYear)}</span>
                </div>
              </div>
              <YearHeatmap
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
