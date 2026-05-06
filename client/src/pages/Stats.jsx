import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api.js';
import { fmtShortDate, fmtShortMonth, fmtIsoWeekMonday, formatYear } from '../utils.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';

function DonutChart({ title, data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  return (
    <div className="bg-card rounded-lg p-4 flex flex-col items-center gap-3">
      <p className="text-xs font-semibold text-neutral-600 uppercase tracking-wider self-start">{title}</p>
      <PieChart width={120} height={120}>
        <Pie data={data} cx={55} cy={55} innerRadius={36} outerRadius={54} dataKey="value" strokeWidth={0}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip
          contentStyle={{ background: '#1c1c1c', border: '1px solid #333', borderRadius: 6, fontSize: 11 }}
          labelStyle={{ display: 'none' }}
          formatter={(value, name) => [`${value} (${Math.round((value / total) * 100)}%)`, name]}
        />
      </PieChart>
      <div className="space-y-1.5 w-full">
        {data.map((d, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
              <span className="text-neutral-400">{d.name}</span>
            </div>
            <span className="text-neutral-500">{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordCard({ label, book, value }) {
  if (!book) return null;
  return (
    <Link to={`/books/${book.id}`} className="bg-card rounded-lg p-3 flex items-center gap-3 hover:ring-1 hover:ring-neutral-600 transition-shadow">
      <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {book.cover_path
          ? <img src={book.cover_path} alt={book.title} className="w-full h-full object-cover object-top" />
          : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-neutral-500 mb-0.5">{label}</p>
        <p className="text-xs font-medium text-neutral-200 truncate">{book.title}</p>
        {value && <p className="text-xs text-neutral-600 mt-0.5">{value}</p>}
      </div>
    </Link>
  );
}

function StatCard({ label, value, sub, href }) {
  const inner = (
    <>
      <div className="text-2xl font-semibold text-parchment">{value ?? '—'}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-neutral-600 mt-1">{sub}</div>}
    </>
  );
  return href
    ? <Link to={href} className="bg-card rounded-lg p-4 block hover:ring-1 hover:ring-neutral-600 transition-shadow">{inner}</Link>
    : <div className="bg-card rounded-lg p-4">{inner}</div>;
}

function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </div>
  );
}

const FROM_STATS = { from: 'Stats', fromPath: '/stats' };

function Bar({ label, count, max, color = 'bg-oak', href, caption }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const labelEl = href
    ? <Link to={href} state={FROM_STATS} className="text-xs text-neutral-400 w-28 flex-shrink-0 truncate hover:text-parchment transition-colors" title={label}>{label}</Link>
    : <span className="text-xs text-neutral-400 w-28 flex-shrink-0 truncate" title={label}>{label}</span>;
  return (
    <div className="flex items-center gap-3">
      {labelEl}
      <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs text-neutral-500 text-right tabular-nums whitespace-nowrap ${caption ? '' : 'w-8'}`}>
        {caption ?? count}
      </span>
    </div>
  );
}

function formatHours(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h.toLocaleString()}h ${m}m` : `${h.toLocaleString()}h`;
}

const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

function GoalCard({ label, current, goal, onSave, onEditStart, color = 'bg-oak' }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0;

  function handleSubmit(e) {
    e.preventDefault();
    const val = parseInt(input);
    // Reject blank / zero / negative submissions: keep the editor open so
    // the user has a visible signal their input wasn't accepted, instead of
    // the form silently collapsing as if it took.
    if (isNaN(val) || val <= 0) return;
    onSave(val);
    setEditing(false);
  }

  return (
    <div className="bg-card rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">{label}</span>
        {editing ? (
          <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
            <input
              type="number" min="1" autoFocus
              value={input} onChange={e => setInput(e.target.value)}
              onBlur={(e) => { if (e.relatedTarget?.type === 'submit') return; setEditing(false); }}
              className="w-16 bg-neutral-800 border border-neutral-600 text-parchment text-xs rounded px-2 py-0.5 focus:outline-none focus:border-oak/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button type="submit" className="text-xs text-oak hover:text-leather transition-colors">set</button>
          </form>
        ) : (
          <button
            onClick={() => { onEditStart?.(); setInput(goal ? String(goal) : ''); setEditing(true); }}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors tabular-nums"
          >
            {current.toLocaleString()} / {goal ? goal.toLocaleString() : <span className="text-neutral-700">set goal</span>}
          </button>
        )}
      </div>
      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {goal > 0 && (
        <p className="text-xs text-neutral-600">{pct}%{pct >= 100 ? ' — goal reached!' : ''}</p>
      )}
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState(null);
  // Separate from `error` because that one fully replaces the page on
  // load failure. saveGoal rollbacks should leave the page intact.
  const [actionError, setActionError] = useState(null);
  // Distinct from `error` so a flaky settings fetch doesn't blank out
  // the entire stats page (settings only feed the three Goal cards).
  const [settingsError, setSettingsError] = useState(null);
  const refreshTick = useRefreshTick();

  useEffect(() => {
    // Two independent fetches: stats is load-bearing (no stats = nothing
    // to render), settings is supplementary (only feeds the Goals section).
    // Each runs its own .then so the stats page renders as soon as the
    // heavy stats payload arrives — a slow settings fetch shouldn't keep
    // the whole page on null. Goals appear (or show settingsError) once
    // settings resolves separately.
    let stale = false;

    api.getStats()
      .then(s => { if (!stale) { setStats(s); setError(null); } })
      .catch(() => { if (!stale) setError('Failed to load stats'); });

    api.getSettings()
      .then(g => { if (!stale) { setSettings(g); setSettingsError(null); } })
      .catch(() => { if (!stale) setSettingsError('Failed to load goals.'); });

    return () => { stale = true; };
  }, [refreshTick]);

  async function saveGoal(key, value) {
    const prev = settings[key];
    setActionError(null);
    setSettings(s => ({ ...s, [key]: String(value) }));
    try {
      await api.setSetting(key, value);
    } catch {
      setSettings(s => ({ ...s, [key]: prev }));
      setActionError('Failed to save goal.');
    }
  }

  if (error) return <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats) return null;

  const { totals, formats, fiction, ownedStatus, ratings, pagesRead, minutesListened, byYear, byMonth = [], topAuthors, topNarrators, languages, streaks, todayPages, thisYearBooks, thisYearPages, topTags, topSeries, avgPagesPerDay, avgDaysToFinish, inProgressPace = [], decadesPublished = [], records } = stats;

  const maxRating = Math.max(...ratings.map(r => r.count), 1);
  const maxYear   = Math.max(...byYear.map(y => y.count), 1);
  const maxMonth  = Math.max(...byMonth.map(m => m.days), 1);
  const maxAuthor   = Math.max(...topAuthors.map(a => a.count), 1);
  const maxNarrator = Math.max(...(topNarrators?.map(n => n.count) || []), 1);
  const maxFormat = Math.max(...formats.map(f => f.count), 1);

  const fictionTotal = (fiction.fiction ?? 0) + (fiction.nonfiction ?? 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Stats</h1>

      {actionError && <p className="text-xs text-warn">{actionError}</p>}

      <Section title="Goals">
        {settingsError && <p className="text-xs text-warn mb-2">{settingsError}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <GoalCard
            label="Pages today"
            current={todayPages}
            goal={settings.daily_pages_goal ? parseInt(settings.daily_pages_goal) : 0}
            onSave={v => saveGoal('daily_pages_goal', v)}
            onEditStart={() => setActionError(null)}
            color="bg-oak"
          />
          <GoalCard
            label={`Pages in ${new Date().getFullYear()}`}
            current={thisYearPages}
            goal={settings.yearly_pages_goal ? parseInt(settings.yearly_pages_goal) : 0}
            onSave={v => saveGoal('yearly_pages_goal', v)}
            onEditStart={() => setActionError(null)}
            color="bg-oak"
          />
          <GoalCard
            label={`Books in ${new Date().getFullYear()}`}
            current={thisYearBooks}
            goal={settings.yearly_books_goal ? parseInt(settings.yearly_books_goal) : 0}
            onSave={v => saveGoal('yearly_books_goal', v)}
            onEditStart={() => setActionError(null)}
            color="bg-leather"
          />
        </div>
      </Section>

      <Section title="Library">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard label="Total books" value={totals.books?.toLocaleString()} href="/?tab=all" />
          <StatCard label="Owned" value={totals.owned?.toLocaleString()} href="/?tab=owned" />
          <StatCard label="Prev. owned" value={totals.previously_owned?.toLocaleString()} href="/?tab=prev_owned" />
          <StatCard label="Finished" value={totals.finished?.toLocaleString()} href="/?tab=finished" />
          <StatCard label="Reading" value={totals.reading?.toLocaleString()} href="/?tab=reading" />
          <StatCard label="Paused" value={totals.paused?.toLocaleString()} href="/?tab=paused" />
          <StatCard label="Unread" value={totals.unread?.toLocaleString()} href="/?tab=unread" />
          {totals.loved > 0 && <StatCard label="Loved" value={totals.loved?.toLocaleString()} href="/?tab=loved" />}
        </div>
      </Section>

      <Section title="Breakdown">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <DonutChart
            title="Fiction"
            data={[
              { name: 'Fiction',     value: fiction.fiction    ?? 0, color: '#a97954' },
              { name: 'Non-fiction', value: fiction.nonfiction ?? 0, color: '#c29b87' },
              { name: 'Unknown',     value: fiction.unset      ?? 0, color: '#404040' },
            ].filter(d => d.value > 0)}
          />
          <DonutChart
            title="Format"
            data={formats.map((f, i) => ({
              name:  FORMAT_LABEL[f.format] || (f.format ? f.format.charAt(0).toUpperCase() + f.format.slice(1) : 'Unknown'),
              value: f.count,
              color: ['#a97954', '#c29b87', '#532c2e', '#404040'][i % 4],
            }))}
          />
          <DonutChart
            title="Status"
            data={[
              { name: 'Finished', value: ownedStatus?.finished ?? 0, color: '#a97954' },
              { name: 'Reading',  value: ownedStatus?.reading  ?? 0, color: '#c29b87' },
              { name: 'Paused',   value: ownedStatus?.paused   ?? 0, color: '#532c2e' },
              { name: 'Unread',   value: ownedStatus?.unread   ?? 0, color: '#404040' },
            ].filter(d => d.value > 0)}
          />
        </div>
      </Section>

      <Section title="Reading">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Pages read" value={pagesRead?.toLocaleString()} />
          <StatCard label="Time listened" value={formatHours(minutesListened)} />
          {avgPagesPerDay != null && (
            <StatCard label="Avg pages / reading day" value={avgPagesPerDay?.toLocaleString()} />
          )}
          {avgDaysToFinish != null && (
            <StatCard label="Avg days to finish" value={avgDaysToFinish?.toLocaleString()} />
          )}
        </div>
      </Section>

      {inProgressPace.length > 0 && (
        <Section title="Currently reading">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {inProgressPace.map(b => (
              <Link key={b.id} to={`/books/${b.id}`} className="bg-card rounded-lg p-3 flex items-center gap-3 hover:ring-1 hover:ring-neutral-600 transition-shadow">
                <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
                  {b.cover_path
                    ? <img src={b.cover_path} alt={b.title} className="w-full h-full object-cover object-top" />
                    : <div className="w-full h-full bg-gradient-to-br from-neutral-700 to-neutral-900" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-neutral-200 truncate">{b.title}</p>
                  <div className="mt-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-oak" style={{ width: `${b.pct ?? 0}%` }} />
                  </div>
                  <p className="text-xs text-neutral-600 mt-1 tabular-nums">
                    {b.pct != null ? `${b.pct}%` : '—'}
                    {b.projected_days_left != null
                      ? ` · ~${b.projected_days_left} ${b.projected_days_left === 1 ? 'day' : 'days'} left`
                      : ''}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {Object.values(records).some(Boolean) && (
        <Section title="Records">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <RecordCard label="Longest read" book={records.longestRead} value={records.longestRead?.page_count ? `${records.longestRead.page_count.toLocaleString()} pages` : null} />
            <RecordCard label="Shortest read" book={records.shortestRead} value={records.shortestRead?.page_count ? `${records.shortestRead.page_count.toLocaleString()} pages` : null} />
            {records.longestAudiobook && <RecordCard label="Longest audiobook" book={records.longestAudiobook} value={formatHours(records.longestAudiobook.duration_minutes)} />}
            <RecordCard label="Oldest edition" book={records.oldestEdition} value={records.oldestEdition?.year_published != null ? `Published ${formatYear(records.oldestEdition.year_published)}` : null} />
            <RecordCard label="Newest edition" book={records.newestEdition} value={records.newestEdition?.year_published != null ? `Published ${formatYear(records.newestEdition.year_published)}` : null} />
            <RecordCard label="First finished" book={records.firstFinished} value={records.firstFinished?.date_finished ? new Date(records.firstFinished.date_finished + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null} />
            <RecordCard label="Last finished" book={records.lastFinished} value={records.lastFinished?.date_finished ? new Date(records.lastFinished.date_finished + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null} />
            {records.mostReread && <RecordCard label="Most re-read" book={records.mostReread} value={`${records.mostReread.read_count} times`} />}
          </div>
        </Section>
      )}

      <Section title="Streaks">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-lg p-4 space-y-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Daily</p>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-2xl font-semibold text-parchment">{streaks.days.current}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {streaks.days.current > 0 && streaks.days.currentStart
                    ? `since ${fmtShortDate(streaks.days.currentStart)}`
                    : 'current'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-neutral-400">{streaks.days.longest}</div>
                <div className="text-xs text-neutral-600 mt-0.5">
                  {streaks.days.longest > 0 && streaks.days.longestStart
                    ? `${fmtShortDate(streaks.days.longestStart)} – ${fmtShortDate(streaks.days.longestEnd)}`
                    : 'longest'}
                </div>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-lg p-4 space-y-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Weekly</p>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-2xl font-semibold text-parchment">{streaks.weeks.current}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {streaks.weeks.current > 0 && streaks.weeks.currentStart
                    ? `since ${fmtIsoWeekMonday(streaks.weeks.currentStart)}`
                    : 'current'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-neutral-400">{streaks.weeks.longest}</div>
                <div className="text-xs text-neutral-600 mt-0.5">
                  {streaks.weeks.longest > 0 && streaks.weeks.longestStart
                    ? `${fmtIsoWeekMonday(streaks.weeks.longestStart)} – ${fmtIsoWeekMonday(streaks.weeks.longestEnd)}`
                    : 'longest'}
                </div>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-lg p-4 space-y-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold">Monthly</p>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-2xl font-semibold text-parchment">{streaks.months.current}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {streaks.months.current > 0 && streaks.months.currentStart
                    ? `since ${fmtShortMonth(streaks.months.currentStart)}`
                    : 'current'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-neutral-400">{streaks.months.longest}</div>
                <div className="text-xs text-neutral-600 mt-0.5">
                  {streaks.months.longest > 0 && streaks.months.longestStart
                    ? `${fmtShortMonth(streaks.months.longestStart)} – ${fmtShortMonth(streaks.months.longestEnd)}`
                    : 'longest'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <Section title="Format">
          <div className="space-y-2.5">
            {formats.filter(f => f.format).map(f => (
              <Bar key={f.format} label={FORMAT_LABEL[f.format] ?? f.format} count={f.count} max={maxFormat} href={`/browse/format/${f.format}`} />
            ))}
            {formats.some(f => !f.format) && (
              <Bar label="Unknown" count={formats.find(f => !f.format).count} max={maxFormat} color="bg-neutral-600" />
            )}
          </div>
        </Section>

        <Section title="Fiction / Non-fiction">
          <div className="space-y-2.5">
            <Bar label="Fiction" count={fiction.fiction ?? 0} max={fictionTotal || 1} color="bg-leather" href="/browse/fiction/fiction" />
            <Bar label="Non-fiction" count={fiction.nonfiction ?? 0} max={fictionTotal || 1} color="bg-binding" href="/browse/fiction/nonfiction" />
            {fiction.unset > 0 && (
              <Bar label="Unset" count={fiction.unset} max={totals.books || 1} color="bg-neutral-600" href="/browse/fiction/unset" />
            )}
          </div>
        </Section>

        <Section title="Ratings">
          <div className="space-y-2.5">
            {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map(r => {
              const entry = ratings.find(x => x.rating === r);
              if (!entry) return null;
              const full = Math.floor(r);
              const half = r % 1 !== 0;
              return (
                <Bar
                  key={r}
                  label={'★'.repeat(full) + (half ? '½' : '')}
                  count={entry.count}
                  max={maxRating}
                  color="bg-oak"
                  href={`/browse/rating/${r}`}
                />
              );
            })}
            {ratings.length === 0 && <p className="text-xs text-neutral-600">No ratings yet</p>}
          </div>
        </Section>

        {topAuthors.length > 0 && (
          <Section title="Top authors">
            <div className="space-y-2.5">
              {topAuthors.map(a => (
                <Bar key={a.author} label={a.author} count={a.count} max={maxAuthor} color="bg-binding" href={`/browse/author/${encodeURIComponent(a.author)}`} />
              ))}
            </div>
          </Section>
        )}

        {topNarrators?.length > 0 && (
          <Section title="Top narrators">
            <div className="space-y-2.5">
              {topNarrators.map(n => (
                <Bar key={n.narrator} label={n.narrator} count={n.count} max={maxNarrator} color="bg-oak" href={`/browse/narrator/${encodeURIComponent(n.narrator)}`} />
              ))}
            </div>
          </Section>
        )}

        {topSeries?.length > 0 && (
          <Section title="Top series">
            <div className="space-y-2.5">
              {topSeries.map(s => (
                <Bar key={s.series} label={s.series} count={s.count} max={topSeries[0].count} color="bg-leather" href={`/browse/series/${encodeURIComponent(s.series)}`} />
              ))}
            </div>
          </Section>
        )}

        {topTags?.length > 0 && (
          <Section title="Top tags">
            <div className="space-y-2.5">
              {topTags.map(t => (
                <Bar key={t.name} label={t.name} count={t.count} max={topTags[0].count} color="bg-oak" href={`/browse/tag/${encodeURIComponent(t.name)}`} />
              ))}
            </div>
          </Section>
        )}

        {languages.length > 1 && (
          <Section title="Languages">
            <div className="space-y-2.5">
              {languages.map(l => (
                <Bar key={l.language} label={l.language} count={l.count}
                  max={Math.max(...languages.map(x => x.count))} color="bg-binding" href={`/browse/language/${encodeURIComponent(l.language)}`} />
              ))}
            </div>
          </Section>
        )}
      </div>

      {byMonth.length > 0 && (
        <Section title="Days read per month">
          <div className="space-y-2.5">
            {byMonth.map(m => {
              const [y, mo] = m.month.split('-').map(Number);
              const label = new Date(y, mo - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
              return (
                <Bar
                  key={m.month}
                  label={label}
                  count={m.days}
                  max={maxMonth}
                  color="bg-oak"
                  caption={`${m.days} ${m.days === 1 ? 'day' : 'days'}`}
                />
              );
            })}
          </div>
        </Section>
      )}

      {decadesPublished.length > 0 && (() => {
        // Fill in zero-count buckets between min and max so gaps in the
        // timeline read visually instead of getting compressed away. Each
        // column gets the native title for exact decade + count.
        const sorted = [...decadesPublished].sort((a, b) => a.decade - b.decade);
        const minDecade = sorted[0].decade;
        const maxDecade = sorted[sorted.length - 1].decade;
        const counts = new Map(sorted.map(d => [d.decade, d.count]));
        const buckets = [];
        for (let d = minDecade; d <= maxDecade; d += 10) {
          buckets.push({ decade: d, count: counts.get(d) ?? 0 });
        }
        const maxCount = Math.max(...buckets.map(b => b.count), 1);
        // 0 belongs on the CE side ("0s" = years 0–9 CE), not BCE — only
        // strictly negative bucket ids are pre-Common-Era.
        const decadeLabel = (d) => d >= 0 ? `${d}s` : `${-d - 9}–${-d} BCE`;
        return (
          <Section title="First published by decade">
            <div>
              <div className="flex items-end gap-px h-24">
                {buckets.map(b => (
                  <div
                    key={b.decade}
                    className={`flex-1 rounded-t transition-colors min-h-[1px] ${b.count > 0 ? 'bg-binding/70 hover:bg-binding' : 'bg-neutral-800'}`}
                    style={{ height: `${(b.count / maxCount) * 100}%` }}
                    title={`${decadeLabel(b.decade)} · ${b.count} ${b.count === 1 ? 'book' : 'books'}`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-neutral-600 tabular-nums mt-1.5">
                <span>{decadeLabel(minDecade)}</span>
                <span>{decadeLabel(maxDecade)}</span>
              </div>
            </div>
          </Section>
        );
      })()}

      {byYear.length > 0 && (
        <Section title="Finished by year">
          <div className="space-y-2.5">
            {byYear.map(y => {
              const parts = [`${y.count} ${y.count === 1 ? 'book' : 'books'}`];
              if (y.pages > 0) parts.push(`${y.pages.toLocaleString()} pages`);
              return (
                <Bar
                  key={y.year}
                  label={y.year}
                  count={y.count}
                  max={maxYear}
                  color="bg-leather"
                  href={`/browse/year_finished/${y.year}`}
                  caption={parts.join(' · ')}
                />
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
