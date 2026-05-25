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

export default function DataViz() {
  const [stats, setStats] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getStats(), api.getReadingCalendar()])
      .then(([s, c]) => { setStats(s); setCalendar(c); })
      .catch(() => setError('Failed to load data.'));
  }, []);

  const acq = useMemo(
    () => buildAcquisitionPanels(stats?.acquiredByYearAndSource),
    [stats],
  );
  const cal = useMemo(() => buildCalendar(calendar), [calendar]);

  if (error) return <div role="alert" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats || !calendar) return <div role="status" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-neutral-700 text-sm">Loading…</div>;

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
    </div>
  );
}
