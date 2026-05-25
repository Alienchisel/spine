import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

// Top N sources get their own panel; everything else collapses into
// "Other" so the long tail of single-source bookstores doesn't drown out
// the comparison. 6 fits comfortably in a 3-wide grid.
const TOP_N_SOURCES = 6;

// Pivot the flat (year, source, count) rows the server returns into
// per-source year arrays, aligned to a shared year axis. Sources are
// ranked by total; the long tail collapses into "Other".
function buildAcquisitionPanels(rows) {
  if (!rows?.length) return { panels: [], years: [], yMax: 0 };

  const totalsBySource = new Map();
  const cellsBySource = new Map();
  const yearSet = new Set();

  for (const r of rows) {
    const y = r.year;
    const s = r.source;
    const c = r.count;
    yearSet.add(y);
    totalsBySource.set(s, (totalsBySource.get(s) || 0) + c);
    if (!cellsBySource.has(s)) cellsBySource.set(s, new Map());
    cellsBySource.get(s).set(y, c);
  }

  const years = Array.from(yearSet).sort();
  const ranked = Array.from(totalsBySource.entries()).sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, TOP_N_SOURCES);
  const rest = ranked.slice(TOP_N_SOURCES);

  const panels = top.map(([source, total]) => ({
    source,
    total,
    values: years.map(y => cellsBySource.get(source).get(y) || 0),
  }));

  if (rest.length > 0) {
    const otherCells = new Map();
    let otherTotal = 0;
    for (const [source] of rest) {
      otherTotal += totalsBySource.get(source);
      for (const [y, c] of cellsBySource.get(source)) {
        otherCells.set(y, (otherCells.get(y) || 0) + c);
      }
    }
    panels.push({
      source: `Other (${rest.length})`,
      total: otherTotal,
      values: years.map(y => otherCells.get(y) || 0),
    });
  }

  // Shared y-scale across all panels so totals are visually comparable.
  // Round up to the next multiple of 10 for a calmer ceiling, but never
  // round down past the actual max.
  const dataMax = panels.reduce((m, p) => Math.max(m, ...p.values), 0);
  const yMax = Math.max(10, Math.ceil(dataMax / 10) * 10);

  return { panels, years, yMax };
}

// Single panel — minimal SVG bar chart. Range-framed x-axis (the line
// spans only the active data extent, not a padded margin) and only the
// first/last year are labelled in text; the gap is left to be inferred
// from the bar positions, which is enough at this resolution. y-scale
// label is suppressed (it's the same on every panel — shared scale is
// the whole point of a small-multiples display, and printing the same
// number on every panel would fail the eraser test).
function AcquisitionPanel({ source, total, values, years, yMax }) {
  const W = 200, H = 60, FOOT = 12;
  const n = values.length;
  const gap = 1;
  const barW = (W - gap * (n - 1)) / n;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-parchment">{source}</span>
        <span className="text-neutral-500 tabular-nums">{total}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + FOOT}`} className="w-full h-auto" preserveAspectRatio="none">
        {values.map((v, i) => {
          const h = (v / yMax) * H;
          const x = i * (barW + gap);
          const y = H - h;
          return (
            <rect key={years[i]} x={x} y={y} width={barW} height={h} fill="#b8896a">
              <title>{`${years[i]}: ${v}`}</title>
            </rect>
          );
        })}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#525252" strokeWidth={0.4} />
        <text x={0} y={H + FOOT - 2} fontSize="6" fill="#737373">{years[0]}</text>
        <text x={W} y={H + FOOT - 2} fontSize="6" fill="#737373" textAnchor="end">{years[years.length - 1]}</text>
      </svg>
    </div>
  );
}

// ── Experiment #2 — Reading-history calendar grid ─────────────────────────
//
// One row per calendar year, each row a 53×7 grid of small cells (cols
// are weeks, rows are weekdays — top row Sunday, bottom row Saturday).
// Cell saturation encodes the day's reading intensity. Hover any cell
// for the date + raw pages/minutes.
//
// Intensity binning avoids any pages↔minutes conversion factor: a day
// is binned by max(pagesBucket, minutesBucket) where each variable
// independently maps onto a 0-4 scale. Same level = "felt the same
// effort", regardless of which format produced it — honest because no
// equivalence is being claimed.

const CAL_LEVELS = [
  '#1a1816', // 0 — no activity (almost background)
  '#3a2c1f', // 1 — faint warm
  '#5a4029', // 2 — medium warm
  '#8a5d37', // 3 — binding tone
  '#d4a574', // 4 — peak parchment
];

function bucket(value, thresholds) {
  // thresholds is a 4-element array; returns 0-4
  if (value <= 0) return 0;
  for (let i = 0; i < thresholds.length; i++) if (value < thresholds[i]) return i;
  return thresholds.length; // value >= last threshold
}

// Page buckets: 0 | 1-29 | 30-59 | 60-99 | 100+
// Minute buckets: 0 | 1-29 | 30-59 | 60-99 | 100+
// Symmetric, so a 30-page day and a 30-minute day are both "level 2".
function intensityLevel(pages, minutes) {
  const pBucket = bucket(pages, [30, 60, 100]);
  const mBucket = bucket(minutes, [30, 60, 100]);
  return Math.max(pBucket, mBucket);
}

function buildCalendar(rows) {
  if (!rows?.length) return { years: [], byDate: new Map() };
  const byDate = new Map();
  let minY = Infinity, maxY = -Infinity;
  for (const r of rows) {
    byDate.set(r.date, { pages: r.pages, minutes: r.minutes });
    const y = Number(r.date.slice(0, 4));
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const years = [];
  for (let y = maxY; y >= minY; y--) years.push(y);
  return { years, byDate };
}

function CalendarYearRow({ year, byDate, cellSize = 8, gap = 1 }) {
  // Build positions for every day of the year. col = weeks since the
  // year's first display column (Sunday on or before Jan 1); row = day
  // of week (Sun=0). 53 cols covers leap years and Sunday-aligned starts.
  const cells = [];
  const jan1 = new Date(year, 0, 1);
  // Day-of-week offset of Jan 1 in the year-start display grid.
  const startOffset = jan1.getDay();

  for (let m = 0; m < 12; m++) {
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, m, d);
      const dayOfYear = Math.floor((dt - jan1) / (24 * 60 * 60 * 1000));
      const col = Math.floor((dayOfYear + startOffset) / 7);
      const row = dt.getDay();
      const iso = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = byDate.get(iso) || { pages: 0, minutes: 0 };
      const level = intensityLevel(cell.pages, cell.minutes);
      cells.push({ iso, col, row, level, pages: cell.pages, minutes: cell.minutes });
    }
  }

  const cols = 53;
  const W = cols * (cellSize + gap) - gap;
  const H = 7 * (cellSize + gap) - gap;

  // Year total — surfaces beside the label so the eye can scan totals
  // year-over-year without parsing the grid.
  const totals = cells.reduce(
    (acc, c) => ({ pages: acc.pages + c.pages, minutes: acc.minutes + c.minutes, days: acc.days + (c.level > 0 ? 1 : 0) }),
    { pages: 0, minutes: 0, days: 0 }
  );

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-right">
        <div className="text-xs font-semibold text-parchment tabular-nums">{year}</div>
        <div className="text-[10px] text-neutral-600 tabular-nums">{totals.days} d · {totals.pages} p · {totals.minutes} m</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="shrink-0">
        {cells.map(c => (
          <rect
            key={c.iso}
            x={c.col * (cellSize + gap)}
            y={c.row * (cellSize + gap)}
            width={cellSize}
            height={cellSize}
            fill={CAL_LEVELS[c.level]}
            rx={1}
          >
            <title>{`${c.iso} ${c.pages} pages ${c.minutes} min`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

function CalendarLegend() {
  // Compact "Less … More" strip mirroring the 5-level palette, with
  // explicit page/minute thresholds noted below so the reader can map
  // colour to data without leaving the figure.
  const size = 10, gap = 2;
  const W = CAL_LEVELS.length * (size + gap) - gap;
  return (
    <div className="flex items-center gap-2 text-[10px] text-neutral-500">
      <span>Less</span>
      <svg viewBox={`0 0 ${W} ${size}`} width={W} height={size}>
        {CAL_LEVELS.map((c, i) => (
          <rect key={i} x={i * (size + gap)} y={0} width={size} height={size} fill={c} rx={1} />
        ))}
      </svg>
      <span>More</span>
      <span className="ml-2 text-neutral-600">levels at 30 / 60 / 100 pages or minutes</span>
    </div>
  );
}

// ── Experiment #3 — Authors-as-lifespan timeline ─────────────────────────
//
// Marey-style horizontal bars: one row per author (sorted oldest birth at
// top), bar spans birth → death year, dot at lifespan midpoint sized by
// books-in-library. Range-framed x-axis tells the chronological extent
// without padding. Top-N by book count get inline labels so the densest
// rows in your collection are named directly.

const LIFESPAN_TOP_LABELS = 12;

// Parse a Spine date field. Accepts: "1856", "1856-04-22", "-100", "-100-03-15".
// Returns the signed year, or null. We only need year-level precision; a
// month/day adds nothing at this resolution.
function parseSignedYear(s) {
  if (!s) return null;
  const m = String(s).match(/^(-?\d+)/);
  return m ? Number(m[1]) : null;
}

function fmtYear(y) {
  if (y < 0) return `${-y} BCE`;
  return `${y} CE`;
}

function buildLifespans(authors) {
  if (!authors?.length) return { rows: [], minY: 0, maxY: 0, ticks: [], maxBooks: 0 };
  const rows = [];
  for (const a of authors) {
    const b = parseSignedYear(a.birth_date);
    const d = parseSignedYear(a.death_date);
    if (b == null || d == null || d < b) continue;
    rows.push({
      id: a.id,
      name: a.name,
      birth: b,
      death: d,
      books: a.book_count || 0,
    });
  }
  rows.sort((a, b) => a.birth - b.birth || a.death - b.death);

  const minY = rows.length ? Math.min(...rows.map(r => r.birth)) : 0;
  const maxY = rows.length ? Math.max(...rows.map(r => r.death)) : 0;
  // Round outwards to clean century-aligned ticks for the axis.
  const tickStart = Math.floor(minY / 500) * 500;
  const tickEnd   = Math.ceil(maxY / 500) * 500;
  const ticks = [];
  for (let t = tickStart; t <= tickEnd; t += 500) ticks.push(t);

  const maxBooks = rows.reduce((m, r) => Math.max(m, r.books), 0);
  return { rows, minY, maxY, ticks, maxBooks };
}

function LifespanChart({ rows, minY, maxY, ticks, maxBooks }) {
  const W = 1000, AXIS_H = 18, ROW_H = 3.5;
  const yearSpan = maxY - minY;
  const x = y => ((y - minY) / yearSpan) * W;
  const r = books => Math.max(1.2, Math.sqrt(books) * 0.7);

  // The top-N-by-books set: gets inline labels. Their dots sit on
  // (rowIndex, midpointYear); the label hangs to the right of the dot.
  const labelSet = new Set(
    [...rows].sort((a, b) => b.books - a.books).slice(0, LIFESPAN_TOP_LABELS).map(r => r.id)
  );

  const H = AXIS_H + rows.length * ROW_H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Faint century-aligned tick lines — quiet enough to recede behind
          the bars but present so the eye can locate dates. */}
      {ticks.map(t => (
        <line key={`g-${t}`} x1={x(t)} y1={AXIS_H} x2={x(t)} y2={H} stroke="#262626" strokeWidth={0.4} />
      ))}
      {/* Tick labels along the top — fmtYear adds the BCE/CE qualifier so
          the axis stays self-describing without a separate legend. */}
      {ticks.map(t => (
        <text key={`l-${t}`} x={x(t)} y={AXIS_H - 6} fontSize="8" fill="#737373" textAnchor="middle">{fmtYear(t)}</text>
      ))}
      <line x1={0} y1={AXIS_H - 2} x2={W} y2={AXIS_H - 2} stroke="#525252" strokeWidth={0.4} />

      {rows.map((row, i) => {
        const yMid = AXIS_H + i * ROW_H + ROW_H / 2;
        const x1 = x(row.birth);
        const x2 = x(row.death);
        const mid = (row.birth + row.death) / 2;
        const xMid = x(mid);
        const rad = r(row.books);
        const tip = `${row.name} · ${fmtYear(row.birth)}–${fmtYear(row.death)} · ${row.books} book${row.books === 1 ? '' : 's'}`;
        const labelled = labelSet.has(row.id);
        return (
          <g key={row.id}>
            <line x1={x1} y1={yMid} x2={x2} y2={yMid} stroke="#8a5d37" strokeWidth={1.2}>
              <title>{tip}</title>
            </line>
            <circle cx={xMid} cy={yMid} r={rad} fill="#d4a574">
              <title>{tip}</title>
            </circle>
            {labelled && (
              <text x={xMid + rad + 2} y={yMid + 2.2} fontSize="6" fill="#d4d4d8">
                {row.name} ({row.books})
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Experiment #4 — Cumulative acquired vs finished ──────────────────────
//
// Two-line overlay. Upper line: cumulative books acquired. Lower line:
// cumulative books finished. The shaded area between them is the
// "to-read mountain" — books in the library that haven't been formally
// finished yet. Year-boundary verticals as the only x grid; endpoint
// labels carry the totals so no separate legend is needed.

function TrajectoryChart({ data }) {
  if (!data?.length) return null;
  const W = 1000, H = 200;
  const n = data.length;
  const yMax = Math.max(...data.map(r => r.acquired));
  // Range-framed y: 0 to data extent (rounded up to nearest 100 for a
  // calmer ceiling).
  const yTop = Math.ceil(yMax / 100) * 100;

  const xAt = i => (i / (n - 1)) * W;
  const yAt = v => H - (v / yTop) * H;

  // Year-boundary indices for vertical ticks. The data is monthly, so
  // a new year fires whenever month === '01'. Label below the plot.
  const yearMarks = data
    .map((d, i) => ({ year: Number(d.month.slice(0, 4)), month: d.month.slice(5), i }))
    .filter(d => d.month === '01');

  // Path for the upper (acquired) and lower (finished) lines.
  const acqPath = data.map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)} ${yAt(r.acquired)}`).join(' ');
  const finPath = data.map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)} ${yAt(r.finished)}`).join(' ');
  // Fill polygon for the gap area: upper line forward, lower line back.
  const gapPath =
    data.map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)} ${yAt(r.acquired)}`).join(' ') + ' ' +
    [...data].reverse().map((r, i) => `L${xAt(n - 1 - i)} ${yAt(r.finished)}`).join(' ') + ' Z';

  const last = data[data.length - 1];
  const TOP = 12, BOT = 20; // top padding for label clearance; bottom for year tick text

  return (
    <svg viewBox={`0 0 ${W} ${H + TOP + BOT}`} className="w-full h-auto">
      <g transform={`translate(0, ${TOP})`}>
        {/* Year-boundary verticals — faint, recede behind data. */}
        {yearMarks.map(m => (
          <line key={`y-${m.year}`} x1={xAt(m.i)} y1={0} x2={xAt(m.i)} y2={H} stroke="#262626" strokeWidth={0.4} />
        ))}
        {/* Year labels under the plot — alternate every 2 years to avoid
            crowding if the span is dense. */}
        {yearMarks.filter((_, idx) => idx % 2 === 0).map(m => (
          <text key={`yl-${m.year}`} x={xAt(m.i)} y={H + 12} fontSize="8" fill="#737373" textAnchor="middle">{m.year}</text>
        ))}
        {/* Range-framed baseline. */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#525252" strokeWidth={0.4} />
        {/* The "to-read mountain" — area between acquired (top) and finished (bottom). */}
        <path d={gapPath} fill="#8a5d37" opacity={0.18} />
        {/* Finished line below — soft parchment. */}
        <path d={finPath} fill="none" stroke="#d4a574" strokeWidth={1.4} />
        {/* Acquired line above — saturated binding. */}
        <path d={acqPath} fill="none" stroke="#b8896a" strokeWidth={1.6} />
        {/* Endpoint labels — direct attribution at the line ends, no
            external legend. */}
        <text x={xAt(n - 1) - 4} y={yAt(last.acquired) - 4} fontSize="9" fill="#b8896a" textAnchor="end" fontWeight="600">
          {last.acquired} acquired
        </text>
        <text x={xAt(n - 1) - 4} y={yAt(last.finished) - 4} fontSize="9" fill="#d4a574" textAnchor="end">
          {last.finished} finished · {last.acquired - last.finished}-book gap
        </text>
      </g>
    </svg>
  );
}

export default function DataViz() {
  const [stats, setStats] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [authors, setAuthors] = useState(null);
  const [trajectory, setTrajectory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getStats(),
      api.getReadingCalendar(),
      api.getAuthors(),
      api.getLibraryTrajectory(),
    ])
      .then(([s, c, a, t]) => { setStats(s); setCalendar(c); setAuthors(a); setTrajectory(t); })
      .catch(() => setError('Failed to load data.'));
  }, []);

  const acq = useMemo(
    () => buildAcquisitionPanels(stats?.acquiredByYearAndSource),
    [stats],
  );
  const cal = useMemo(() => buildCalendar(calendar), [calendar]);
  const life = useMemo(() => buildLifespans(authors), [authors]);

  if (error) return <div role="alert" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats || !calendar || !authors || !trajectory) return <div role="status" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-neutral-700 text-sm">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
      <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Data visualization</h1>

      {/* ── Experiment #1 — Acquisitions by source ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #1 — Acquisitions by source</span>, {acq.years[0]}–{acq.years[acq.years.length - 1]}. Small multiples with a shared y-scale ({acq.yMax}/yr ceiling), so the eye can compare each source's tempo against the others. Top {TOP_N_SOURCES} sources by total; the rest collapse into the Other panel.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
          {acq.panels.map(p => (
            <AcquisitionPanel key={p.source} {...p} years={acq.years} yMax={acq.yMax} />
          ))}
        </div>
      </section>

      {/* ── Experiment #2 — Reading-history calendar grid ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #2 — Reading-history calendar</span>, {cal.years[cal.years.length - 1]}–{cal.years[0]}. One row per year; columns are weeks (Sun ↦ Sat top-to-bottom). Cell saturation encodes daily reading intensity, binned independently on pages and minutes so audiobook and print days are comparable without a fake equivalence. Hover any cell for the date and raw totals; row caption shows the year's days-read, pages, minutes.
        </p>
        <CalendarLegend />
        <div className="space-y-1 overflow-x-auto">
          {cal.years.map(y => (
            <CalendarYearRow key={y} year={y} byDate={cal.byDate} />
          ))}
        </div>
      </section>

      {/* ── Experiment #3 — Authors-as-lifespan timeline ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #3 — Authors as lifespans</span>, {fmtYear(life.minY)} – {fmtYear(life.maxY)}. {life.rows.length} authors with both birth and death dates; rows sorted oldest birth first. Each bar spans an author's life; the dot at the midpoint is sized by books-in-library (sqrt scale, max {life.maxBooks}). Top {LIFESPAN_TOP_LABELS} by count are labelled inline. Hover any bar or dot for full attribution.
        </p>
        <div className="overflow-x-auto">
          <LifespanChart {...life} />
        </div>
      </section>

      {/* ── Experiment #4 — Cumulative acquired vs finished ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #4 — Cumulative acquired vs finished</span>, {trajectory[0].month} – {trajectory[trajectory.length - 1].month}. Two monthly running totals overlaid; the shaded area between them is the to-read mountain. Only date-stamped finishes count toward the lower line, so the gap reflects both unread inventory and books finished without a recorded date. (Audit's "Owned books have finish date" gap shows the books missing a date.)
        </p>
        <TrajectoryChart data={trajectory} />
      </section>
    </div>
  );
}
