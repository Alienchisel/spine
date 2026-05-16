import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api.js';
import { fmtShortDate, fmtShortMonth, fmtIsoWeekMonday, formatYear, plural } from '../utils.js';
import { useRefreshTick } from '../hooks/useRefreshTick.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

function DonutChart({ title, data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  // Drop empty buckets and slices that round below 1% — both look like
  // noise in the legend (a 0% row with a colored swatch) and the chart
  // doesn't render them meaningfully anyway. Threshold at 1% so a slice
  // small but identifiable still shows; anything below is structural
  // noise (e.g. Owned status Reading at ~3 of ~460 → 0.6%).
  // Sort largest → smallest so every donut on the page reads the same
  // way: dominant slice at the top of the legend, clockwise sweep from
  // big to small. Without this the four donuts mixed size-sorted (when
  // the source data happened to be) with taxonomy-sorted, which looked
  // arbitrary side-by-side.
  const visible = data
    .filter(d => d.value > 0 && d.value / total >= 0.01)
    .sort((a, b) => b.value - a.value);
  return (
    <div className="bg-card rounded-lg p-4 flex flex-col items-center gap-3">
      <p className="text-xs font-semibold text-neutral-600 uppercase tracking-wider self-start">{title}</p>
      <PieChart width={120} height={120}>
        <Pie data={visible} cx={55} cy={55} innerRadius={36} outerRadius={54} dataKey="value" strokeWidth={0}>
          {visible.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip
          contentStyle={{ background: '#1c1c1c', border: '1px solid #333', borderRadius: 6, fontSize: 11 }}
          labelStyle={{ display: 'none' }}
          formatter={(value, name) => [`${value} (${Math.round((value / total) * 100)}%)`, name]}
        />
      </PieChart>
      <div className="space-y-1.5 w-full">
        {visible.map((d, i) => {
          const inner = (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color }} />
                <span className="text-neutral-400 group-hover:text-parchment transition-colors">{d.name}</span>
              </div>
              <span className="text-neutral-500 group-hover:text-parchment transition-colors">{Math.round((d.value / total) * 100)}%</span>
            </>
          );
          return d.href ? (
            <Link key={i} to={d.href} state={FROM_STATS} className="group flex items-center justify-between text-xs">
              {inner}
            </Link>
          ) : (
            <div key={i} className="flex items-center justify-between text-xs">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordCard({ label, book, value }) {
  if (!book) return null;
  return (
    <Link to={`/books/${book.id}`} state={FROM_STATS} className="bg-card rounded-lg p-3 flex items-center gap-3 hover:ring-1 hover:ring-neutral-600 transition-shadow">
      <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
        {book.cover_path
          ? <img src={book.cover_path} alt="" className="w-full h-full object-cover object-top" />
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

// Vertical bar histogram. Renders count-above bars sized proportionally
// to the max bucket. Used for the pages-per-reading-day distribution
// (and reusable for any one-dim distribution that comes up later).
function Histogram({ data, valueKey = 'days', labelKey = 'label', barColor = 'bg-oak', caption }) {
  const max = Math.max(0, ...data.map(d => d[valueKey] ?? 0));
  const total = data.reduce((s, d) => s + (d[valueKey] ?? 0), 0);
  if (!total) return <p className="text-xs text-neutral-600">No data yet.</p>;
  return (
    <div>
      <div className="flex items-end gap-3 h-40">
        {data.map(d => {
          const v = d[valueKey] ?? 0;
          const pct = max > 0 ? (v / max) * 100 : 0;
          return (
            <div key={d[labelKey]} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
              <span className="text-[10px] text-neutral-500 tabular-nums mb-1">{v.toLocaleString()}</span>
              <div className="w-full bg-neutral-800 rounded-t" style={{ height: '100%' }}>
                <div
                  className={`${barColor} rounded-t w-full transition-all`}
                  style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
                  title={`${d[labelKey]} · ${v.toLocaleString()}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-2">
        {data.map(d => (
          <div key={d[labelKey]} className="flex-1 text-center text-[10px] text-neutral-500 tabular-nums min-w-0 truncate">
            {d[labelKey]}
          </div>
        ))}
      </div>
      {caption && <p className="text-[11px] text-neutral-600 mt-3">{caption}</p>}
    </div>
  );
}

// Squarified treemap layout (Bruls, Huijsen, van Wijk 2000) for a flat
// list of weighted items. Returns each input augmented with a normalised
// rect = { x, y, w, h } in the virtual coordinate space (vw × vh).
// We greedily fill the current strip with items while their worst-case
// aspect ratio keeps improving, then close the strip and recurse on the
// remaining rect — gives near-square tiles for typical long-tail data.
function squarify(items, vw, vh) {
  const sorted = [...items].sort((a, b) => b.value - a.value).filter(d => d.value > 0);
  if (sorted.length === 0) return [];
  const total = sorted.reduce((s, d) => s + d.value, 0);
  const scaled = sorted.map(d => ({ ...d, area: (d.value / total) * vw * vh }));
  const out = [];
  layoutRect(scaled, 0, 0, vw, vh, out);
  return out;
}

function worstAspect(row, shortSide) {
  if (row.length === 0) return Infinity;
  const rowArea = row.reduce((s, it) => s + it.area, 0);
  const thickness = rowArea / shortSide;
  let worst = 0;
  for (const it of row) {
    const longDim = it.area / thickness;
    const r = Math.max(thickness / longDim, longDim / thickness);
    if (r > worst) worst = r;
  }
  return worst;
}

function layoutRect(items, x, y, w, h, out) {
  if (items.length === 0 || w <= 0 || h <= 0) return;
  let i = 0;
  let row = [];
  while (i < items.length) {
    const shortSide = Math.min(w, h);
    const candidate = [...row, items[i]];
    if (row.length === 0 || worstAspect(candidate, shortSide) <= worstAspect(row, shortSide)) {
      row = candidate;
      i++;
    } else {
      break;
    }
  }
  const shortSide = Math.min(w, h);
  const rowArea = row.reduce((s, it) => s + it.area, 0);
  const thickness = rowArea / shortSide;
  if (w >= h) {
    let off = 0;
    for (const it of row) {
      const ih = it.area / thickness;
      out.push({ ...it, rect: { x, y: y + off, w: thickness, h: ih } });
      off += ih;
    }
    layoutRect(items.slice(i), x + thickness, y, w - thickness, h, out);
  } else {
    let off = 0;
    for (const it of row) {
      const iw = it.area / thickness;
      out.push({ ...it, rect: { x: x + off, y, w: iw, h: thickness } });
      off += iw;
    }
    layoutRect(items.slice(i), x, y + thickness, w, h - thickness, out);
  }
}

// Bookish palette for treemap tiles — warm umbers, oxblood, tan, slate.
// Per-tag color is name-hashed so the same tag keeps the same color across
// renders and sessions; the visualization becomes recognizable over time.
const TREEMAP_COLORS = [
  '#a97954', '#c29b87', '#6a5d4f', '#532c2e',
  '#5a7a8a', '#7d6149', '#8c6f54', '#4a3d3a',
];

function colorForTag(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TREEMAP_COLORS[Math.abs(h) % TREEMAP_COLORS.length];
}

function TagTreemap({ tags }) {
  const containerRef = useRef(null);
  // Measure the rendered container so squarify optimises aspect ratios
  // against the actual shape we hand the user. Without this, tiles are
  // laid out for a fixed virtual square and visibly stretched whenever
  // the rendered cell isn't 1:1 (e.g. when the cell stretches to match
  // the donut block's height beside it).
  const [size, setSize] = useState({ w: 400, h: 400 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!tags || tags.length === 0) return null;
  const placed = squarify(
    tags.map(t => ({ name: t.name, value: t.count, count: t.count })),
    size.w,
    size.h,
  );
  return (
    <div ref={containerRef} className="bg-card rounded-lg p-1 h-full min-h-[24rem] relative overflow-hidden">
      {placed.map(t => (
        <Link
          key={t.name}
          to={`/browse/tag/${encodeURIComponent(t.name)}`}
          state={FROM_STATS}
          className="absolute border border-neutral-900 transition-[filter] hover:brightness-125 flex items-center justify-center overflow-hidden text-center"
          style={{
            left:       `${(t.rect.x / size.w) * 100}%`,
            top:        `${(t.rect.y / size.h) * 100}%`,
            width:      `${(t.rect.w / size.w) * 100}%`,
            height:     `${(t.rect.h / size.h) * 100}%`,
            background: colorForTag(t.name),
          }}
          title={`${t.name} · ${plural(t.count, 'book')}`}
        >
          <span className="text-xs text-parchment leading-tight px-1 truncate">{t.name}</span>
        </Link>
      ))}
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
  // Bumped per goal-key on every saveGoal so an earlier failed save's
  // rollback can detect that a later edit on the same key has already
  // applied — without this, A's catch restores `prev` (A's pre-A value)
  // over B's newer optimistic value. Object keyed by goal name because
  // the three goals are independent, and a stale rollback on one
  // shouldn't drop a valid rollback on another. Mirrors the seq guard
  // used in Readlist / ListDetail / ShelfView / ShelfManager / rating
  // saves.
  const goalSaveSeqRef = useRef({});
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
    const seq = goalSaveSeqRef.current[key] = (goalSaveSeqRef.current[key] ?? 0) + 1;
    try {
      await api.setSetting(key, value);
    } catch {
      if (seq !== goalSaveSeqRef.current[key]) return;
      setSettings(s => ({ ...s, [key]: prev }));
      setActionError('Failed to save goal.');
    }
  }

  // Only replace the whole page when there's no data to show. Once stats
  // are loaded, a subsequent refresh-tick failure surfaces as a dismissible
  // banner above the existing data rather than wiping it — mirrors
  // ShelfView's pattern.
  if (!stats && error) return <div role="alert" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats) return null;

  const { totals, formats, fiction, ownedStatus, ratings, acquisitionSources, pagesRead, minutesListened, byYear, byMonth = [], topAuthors, topNarrators, languages, streaks, todayPages, thisYearBooks, thisYearPages, topTags, topSeries, avgPagesPerDay, avgDaysToFinish, inProgressPace = [], decadesPublished = [], pagesPerDayDistribution = [], records } = stats;

  const maxRating = Math.max(...ratings.map(r => r.count), 1);
  const maxYear   = Math.max(...byYear.map(y => y.count), 1);
  const maxMonth  = Math.max(...byMonth.map(m => m.days), 1);
  const maxAuthor   = Math.max(...topAuthors.map(a => a.count), 1);
  const maxNarrator = Math.max(...(topNarrators?.map(n => n.count) || []), 1);

  // Hero numbers up top: the four headline figures the user is most
  // likely to want to glance at — library size, lifetime pages,
  // lifetime listening, and current day streak. Big monospace numbers
  // with a small uppercase descriptor above, no card chrome — gives
  // the page a "dashboard" first impression.
  const hero = [
    { label: 'Books in library', value: totals?.total?.toLocaleString() ?? '—' },
    { label: 'Pages read',       value: pagesRead?.toLocaleString() ?? '—' },
    { label: 'Hours listened',   value: minutesListened > 0 ? Math.floor(minutesListened / 60).toLocaleString() : '—' },
    { label: 'Day streak',       value: streaks?.days?.current?.toLocaleString() ?? '0' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Stats</h1>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {actionError && <p role="alert" className="text-xs text-warn">{actionError}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-10 py-4">
        {hero.map(h => (
          <div key={h.label} className="text-center sm:text-left">
            <p className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider mb-1">{h.label}</p>
            <p className="font-slab text-4xl sm:text-5xl text-parchment tabular-nums leading-none">{h.value}</p>
          </div>
        ))}
      </div>

      {inProgressPace.length > 0 && (
        <Section title="Currently reading">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {inProgressPace.map(b => (
              <Link key={b.id} to={`/books/${b.id}`} state={FROM_STATS} className="bg-card rounded-lg p-3 flex items-center gap-3 hover:ring-1 hover:ring-neutral-600 transition-shadow">
                <div className="w-8 h-12 flex-shrink-0 rounded overflow-hidden bg-neutral-800">
                  {b.cover_path
                    ? <img src={b.cover_path} alt="" className="w-full h-full object-cover object-top" />
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
                      ? ` · ~${plural(b.projected_days_left, 'day')} left`
                      : ''}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section title="Goals">
        {settingsError && <p role="alert" className="text-xs text-warn mb-2">{settingsError}</p>}
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
          <StatCard label="Never owned" value={totals.never_owned?.toLocaleString()} href="/?tab=never_owned" />
          <StatCard label="Finished" value={totals.finished?.toLocaleString()} href="/?tab=finished" />
          <StatCard label="Reading" value={totals.reading?.toLocaleString()} href="/?tab=reading" />
          <StatCard label="Unread" value={totals.unread?.toLocaleString()} href="/?tab=unread" />
          {totals.loved > 0 && <StatCard label="Loved" value={totals.loved?.toLocaleString()} href="/loved" />}
          {totals.custom > 0 && <StatCard label="Custom" value={totals.custom?.toLocaleString()} href="/?tab=all&custom=true" />}
        </div>
      </Section>

      <Section title="Library breakdown">
        {/* Donut row on the left (responsive 2×2 on the breakpoint that the
            treemap appears alongside), tag treemap on the right. The two
            sub-views complement each other: donuts cover the four
            structural taxonomies (fiction / format / status / source),
            the treemap covers the long-tail tag composition. Stacks on
            mobile so neither gets squeezed. */}
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
            <DonutChart
              title="Fiction / Non-fiction"
              // Fiction isn't a URL-state filter on Library — the existing
              // /browse/fiction/:value page handles it, same target the
              // Fiction bar list further down uses.
              data={[
                { name: 'Fiction',     value: fiction.fiction    ?? 0, color: '#a97954', href: '/browse/fiction/fiction' },
                { name: 'Non-fiction', value: fiction.nonfiction ?? 0, color: '#c29b87', href: '/browse/fiction/nonfiction' },
                { name: 'Unknown',     value: fiction.unset      ?? 0, color: '#404040', href: '/browse/fiction/unset' },
              ].filter(d => d.value > 0)}
            />
            <DonutChart
              title="Format"
              data={formats.map((f, i) => ({
                name:  FORMAT_LABEL[f.format] || (f.format ? f.format.charAt(0).toUpperCase() + f.format.slice(1) : 'Unknown'),
                value: f.count,
                color: ['#a97954', '#c29b87', '#532c2e', '#404040'][i % 4],
                href:  f.format ? `/?tab=all&formats=${f.format}` : null,
              }))}
            />
            <DonutChart
              // Slices are over owned-purchased media (custom + Internet
              // excluded) — same scope as every other donut in this section,
              // captured once at the section title. The Library "Reading"
              // tile above is corpus-wide and counts a different population.
              title="Reading status"
              data={[
                { name: 'Finished', value: ownedStatus?.finished ?? 0, color: '#a97954', href: '/?tab=finished' },
                { name: 'Reading',  value: ownedStatus?.reading  ?? 0, color: '#c29b87', href: '/?tab=reading' },
                { name: 'Unread',   value: ownedStatus?.unread   ?? 0, color: '#404040', href: '/?tab=unread' },
              ].filter(d => d.value > 0)}
            />
            {acquisitionSources && (
              // Where does my library come from? Includes Internet-sourced
              // even though the Owned tab/count excludes them — this chart's
              // explicit purpose is the purchased-vs-downloaded distinction.
              // "Other" has no single acquisition_source value (it's the
              // bucket for anything not in the named columns), so no link.
              <DonutChart
                title="Source"
                data={[
                  { name: 'Kindle',   value: acquisitionSources.kindle   ?? 0, color: '#a97954', href: '/?tab=all&sources=Kindle' },
                  { name: 'Audible',  value: acquisitionSources.audible  ?? 0, color: '#c29b87', href: '/?tab=all&sources=Audible' },
                  { name: 'Amazon',   value: acquisitionSources.amazon   ?? 0, color: '#532c2e', href: '/?tab=all&sources=Amazon' },
                  { name: 'Other',    value: acquisitionSources.other    ?? 0, color: '#6a5d4f' },
                  { name: 'Internet', value: acquisitionSources.internet ?? 0, color: '#5a7a8a', href: '/?tab=all&sources=Internet' },
                  { name: 'Unknown',  value: acquisitionSources.unknown  ?? 0, color: '#404040', href: '/?tab=all&missing=source' },
                ].filter(d => d.value > 0)}
              />
            )}
          </div>
          {topTags?.length > 0 && <TagTreemap tags={topTags} />}
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

      {pagesPerDayDistribution.some(b => b.days > 0) && (
        <Section title="Pages per reading day">
          <div className="bg-card rounded-lg p-5">
            <Histogram
              data={pagesPerDayDistribution}
              valueKey="days"
              labelKey="label"
              caption={`Distribution of your ${pagesPerDayDistribution.reduce((s, b) => s + b.days, 0).toLocaleString()} page-logged reading days.`}
            />
          </div>
        </Section>
      )}

      {Object.values(records).some(Boolean) && (() => {
        const pages = (b) => b ? `${b.page_count.toLocaleString()} pages` : null;
        const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
        const subhead = "text-[11px] font-semibold text-neutral-700 uppercase tracking-wider mb-2";
        const subgrid = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3";
        const hasPhysical  = records.longestReadPhysical  || records.shortestReadPhysical  || records.longestLibraryPhysical  || records.shortestLibraryPhysical;
        const hasDigital   = records.longestReadDigital   || records.shortestReadDigital   || records.longestLibraryDigital   || records.shortestLibraryDigital;
        const hasAudiobook = records.longestReadAudiobook || records.shortestReadAudiobook || records.longestLibraryAudiobook || records.shortestLibraryAudiobook;
        const hasEdition   = records.oldestEdition || records.newestEdition;
        const hasReading   = records.firstFinished || records.lastFinished || records.mostReread;
        return (
          <Section title="Records">
            <div className="space-y-5">
              {hasPhysical && (
                <div>
                  <h3 className={subhead}>Physical</h3>
                  <div className={subgrid}>
                    {records.longestReadPhysical     && <RecordCard label="Longest read"         book={records.longestReadPhysical}     value={pages(records.longestReadPhysical)} />}
                    {records.shortestReadPhysical    && <RecordCard label="Shortest read"        book={records.shortestReadPhysical}    value={pages(records.shortestReadPhysical)} />}
                    {records.longestLibraryPhysical  && <RecordCard label="Longest in library"   book={records.longestLibraryPhysical}  value={pages(records.longestLibraryPhysical)} />}
                    {records.shortestLibraryPhysical && <RecordCard label="Shortest in library"  book={records.shortestLibraryPhysical} value={pages(records.shortestLibraryPhysical)} />}
                  </div>
                </div>
              )}
              {hasDigital && (
                <div>
                  <h3 className={subhead}>Digital</h3>
                  <div className={subgrid}>
                    {records.longestReadDigital     && <RecordCard label="Longest read"         book={records.longestReadDigital}     value={pages(records.longestReadDigital)} />}
                    {records.shortestReadDigital    && <RecordCard label="Shortest read"        book={records.shortestReadDigital}    value={pages(records.shortestReadDigital)} />}
                    {records.longestLibraryDigital  && <RecordCard label="Longest in library"   book={records.longestLibraryDigital}  value={pages(records.longestLibraryDigital)} />}
                    {records.shortestLibraryDigital && <RecordCard label="Shortest in library"  book={records.shortestLibraryDigital} value={pages(records.shortestLibraryDigital)} />}
                  </div>
                </div>
              )}
              {hasAudiobook && (
                <div>
                  <h3 className={subhead}>Audiobook</h3>
                  <div className={subgrid}>
                    {records.longestReadAudiobook     && <RecordCard label="Longest read"        book={records.longestReadAudiobook}     value={formatHours(records.longestReadAudiobook.duration_minutes)} />}
                    {records.shortestReadAudiobook    && <RecordCard label="Shortest read"       book={records.shortestReadAudiobook}    value={formatHours(records.shortestReadAudiobook.duration_minutes)} />}
                    {records.longestLibraryAudiobook  && <RecordCard label="Longest in library"  book={records.longestLibraryAudiobook}  value={formatHours(records.longestLibraryAudiobook.duration_minutes)} />}
                    {records.shortestLibraryAudiobook && <RecordCard label="Shortest in library" book={records.shortestLibraryAudiobook} value={formatHours(records.shortestLibraryAudiobook.duration_minutes)} />}
                  </div>
                </div>
              )}
              {hasEdition && (
                <div>
                  <h3 className={subhead}>Edition</h3>
                  <div className={subgrid}>
                    <RecordCard label="Oldest edition" book={records.oldestEdition} value={records.oldestEdition?.year_published != null ? `Published ${formatYear(records.oldestEdition.year_published)}` : null} />
                    <RecordCard label="Newest edition" book={records.newestEdition} value={records.newestEdition?.year_published != null ? `Published ${formatYear(records.newestEdition.year_published)}` : null} />
                  </div>
                </div>
              )}
              {hasReading && (
                <div>
                  <h3 className={subhead}>Reading</h3>
                  <div className={subgrid}>
                    <RecordCard label="First finished" book={records.firstFinished} value={fmtDate(records.firstFinished?.date_finished)} />
                    <RecordCard label="Last finished"  book={records.lastFinished}  value={fmtDate(records.lastFinished?.date_finished)} />
                    {records.mostReread && <RecordCard label="Most re-read" book={records.mostReread} value={records.mostReread.read_count ? `${records.mostReread.read_count} times` : null} />}
                  </div>
                </div>
              )}
            </div>
          </Section>
        );
      })()}

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
                <Bar
                  key={a.author_id ?? a.author}
                  label={a.aliases_count > 0 ? `${a.author} +${a.aliases_count}` : a.author}
                  count={a.count}
                  max={maxAuthor}
                  color="bg-binding"
                  href={a.author_id ? `/authors/${a.author_id}` : `/browse/author/${encodeURIComponent(a.author)}`}
                />
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
                  caption={plural(m.days, 'day')}
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
                    title={`${decadeLabel(b.decade)} · ${plural(b.count, 'book')}`}
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
              const parts = [plural(y.count, 'book')];
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
