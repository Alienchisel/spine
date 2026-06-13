import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useFreshFetch } from '../hooks/useFreshFetch.js';
import PageHeading from '../components/PageHeading.jsx';

const FROM_DV = { from: 'Data viz', fromPath: '/data-viz' };

// ── Experiment #1 — Acquisitions by source ───────────────────────────────

// Top N sources get their own panel; everything else collapses into
// "Other" so the long tail of single-source bookstores doesn't drown
// out the comparison. 3 isolates the dominant Kindle / Audible / Amazon
// trio against an Other bucket; the four panels lay out as a 2x2 grid.
const TOP_N_SOURCES = 3;

const COMPLETION_TABS = [
  { key: 'in_progress', label: 'In progress' },
  { key: 'complete',    label: 'Complete'    },
];

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
// spans only the active data extent, not a padded margin); each year
// is labelled below its own bar via a 90° rotation, which puts every
// label in its own vertical lane so they can't collide. y-scale label
// is suppressed (it's the same on every panel — shared scale is the
// whole point of a small-multiples display, and printing the same
// number on every panel would fail the eraser test).
function AcquisitionPanel({ source, total, values, years, yMax }) {
  const W = 200, H = 60, FOOT = 20;
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
        {/* Per-year vertical labels: rotated 90° clockwise so each year
            reads top-to-bottom below its own bar. The rotation anchor
            is the bar's vertical centerline just below the baseline,
            and textAnchor="start" puts the first character right under
            the bar; subsequent characters extend further down. */}
        {years.map((y, i) => {
          const cx = i * (barW + gap) + barW / 2;
          return (
            <text
              key={`yt-${y}`}
              x={cx}
              y={H + 3}
              fontSize="5"
              fill="#737373"
              textAnchor="start"
              transform={`rotate(90 ${cx} ${H + 3})`}
            >
              {y}
            </text>
          );
        })}
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

function CalendarYearRow({ year, byDate, cellSize = 10, gap = 2 }) {
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

// LifespanChart viewBox constants — shared with the loupe so the
// hover→row-index math is consistent between the chart and its
// magnifier.
const LIFESPAN_W = 1000;
const LIFESPAN_AXIS_H = 18;
const LIFESPAN_ROW_H = 3.5;

// Axis strip — rendered as its own SVG so it can live in a separate
// sticky-positioned container above the body. Same horizontal scale
// + same CSS width as the body, so a JS-synced scrollLeft keeps the
// two horizontally aligned.
function LifespanAxis({ minY, maxY, ticks, zoom }) {
  const W = LIFESPAN_W, AXIS_H = LIFESPAN_AXIS_H;
  const yearSpan = maxY - minY;
  const x = y => ((y - minY) / yearSpan) * W;
  return (
    <svg
      viewBox={`0 0 ${W} ${AXIS_H}`}
      className="block h-auto"
      style={{ width: `${zoom * 100}%` }}
    >
      {ticks.map(t => (
        <text key={`l-${t}`} x={x(t)} y={AXIS_H - 6} fontSize="8" fill="#737373" textAnchor="middle">{fmtYear(t)}</text>
      ))}
      <line x1={0} y1={AXIS_H - 2} x2={W} y2={AXIS_H - 2} stroke="#525252" strokeWidth={0.4} />
    </svg>
  );
}

function LifespanChart({ rows, minY, maxY, ticks, maxBooks, zoom = 1 }) {
  const W = LIFESPAN_W, ROW_H = LIFESPAN_ROW_H;
  const yearSpan = maxY - minY;
  const x = y => ((y - minY) / yearSpan) * W;
  const r = books => Math.max(1.2, Math.sqrt(books) * 0.7);
  const H = rows.length * ROW_H;

  // Top-N inline labels by book count. At higher zoom levels each
  // datapoint occupies more screen space, so progressively more
  // authors get named: at 1× only the top 12 fit, at 5× the top 60.
  // The sort is stable, so adding labels never reshuffles existing
  // ones.
  const labelCount = LIFESPAN_TOP_LABELS * zoom;
  const labelSet = new Set(
    [...rows].sort((a, b) => b.books - a.books).slice(0, labelCount).map(r => r.id)
  );

  return (
    // Zoom scales the SVG's CSS width (not the viewBox), so every
    // element — rows, time-axis ticks, labels, dots — grows uniformly.
    // At zoom > 1 the SVG overflows the parent and the wrapper's
    // overflow-x-auto produces a horizontal scrollbar instead of
    // compacting the content.
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto"
      style={{ width: `${zoom * 100}%` }}
    >
      {ticks.map(t => (
        <line key={`g-${t}`} x1={x(t)} y1={0} x2={x(t)} y2={H} stroke="#262626" strokeWidth={0.4} />
      ))}

      {rows.map((row, i) => {
        const yMid = i * ROW_H + ROW_H / 2;
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

// Discrete zoom levels. 1× is the dense "everything fits on one
// screen" view; higher zoom proportionally scales the SVG's display
// dimensions (both axes) so the chart overflows its container and a
// horizontal scrollbar appears, rather than compacting the time axis.
const LIFESPAN_ZOOM_MIN = 1;
const LIFESPAN_ZOOM_MAX = 5;

function LifespansWithLoupe(life) {
  const [zoom, setZoom] = useState(1);
  // Two independent overflow-x containers: the axis bar is
  // overflow-hidden (user can't grab it; we set its scrollLeft via JS
  // to mirror the body), the body is the real scroller. This is the
  // only way to get a viewport-sticky axis: a single overflow-x: auto
  // ancestor would confine sticky-top to that container instead of
  // the document.
  const axisRef = useRef(null);
  const bodyRef = useRef(null);
  const dragRef = useRef(null);

  const syncScroll = () => {
    if (axisRef.current && bodyRef.current) {
      axisRef.current.scrollLeft = bodyRef.current.scrollLeft;
    }
  };
  // Re-sync after zoom changes (the SVG widths just changed; the
  // browser will preserve scrollLeft but the axis needs to follow).
  useEffect(syncScroll, [zoom]);

  // Click-and-drag pan. mousedown anywhere on the chart sets the drag
  // baseline; global mousemove updates the body's scrollLeft while
  // dragging; mouseup releases. Bound to the document so a drag that
  // overshoots the chart edges still releases cleanly. We skip the
  // drag entirely on interactive elements (buttons) so the +/− zoom
  // controls still work.
  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current || !bodyRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      bodyRef.current.scrollLeft = dragRef.current.startScrollLeft - dx;
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, []);

  function startDrag(e) {
    // Left button only — right-click triggers the context menu (and
    // can leave us in a stuck drag state if its mouseup doesn't reach
    // the document listener), middle-click can spawn a new tab.
    if (e.button !== 0) return;
    if (!bodyRef.current) return;
    if (e.target.closest('button, a, input')) return;
    dragRef.current = {
      startX:           e.clientX,
      startScrollLeft:  bodyRef.current.scrollLeft,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = 'grabbing';
  }

  return (
    <div className="cursor-grab select-none" onMouseDown={startDrag}>
      {/* Sticky header band: zoom controls + axis bar in a single
          sticky container so both stay visible together below the
          h-14 Nav (z-50). z-40 keeps the band above chart content
          but below the Nav, so the Nav tucks over it cleanly. The
          inner zoom row sets cursor-default to opt out of the
          parent's cursor-grab, and the buttons set cursor-pointer
          so they still feel clickable. */}
      <div className="sticky top-14 z-40 bg-neutral-950">
        <div className="flex items-center gap-1 text-xs text-neutral-400 py-2 cursor-default">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500 mr-2">Zoom</span>
          <button
            type="button"
            onClick={() => setZoom(z => Math.max(LIFESPAN_ZOOM_MIN, z - 1))}
            disabled={zoom <= LIFESPAN_ZOOM_MIN}
            aria-label="Zoom out"
            className="w-7 h-7 rounded border border-neutral-700 cursor-pointer hover:border-neutral-500 hover:text-neutral-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:border-neutral-700 transition-colors"
          >−</button>
          <span className="tabular-nums px-2 w-12 text-center">{zoom}×</span>
          <button
            type="button"
            onClick={() => setZoom(z => Math.min(LIFESPAN_ZOOM_MAX, z + 1))}
            disabled={zoom >= LIFESPAN_ZOOM_MAX}
            aria-label="Zoom in"
            className="w-7 h-7 rounded border border-neutral-700 cursor-pointer hover:border-neutral-500 hover:text-neutral-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:border-neutral-700 transition-colors"
          >+</button>
        </div>
        <div ref={axisRef} className="overflow-x-hidden">
          <LifespanAxis minY={life.minY} maxY={life.maxY} ticks={life.ticks} zoom={zoom} />
        </div>
      </div>
      <div ref={bodyRef} className="overflow-x-auto" onScroll={syncScroll}>
        <LifespanChart {...life} zoom={zoom} />
      </div>
    </div>
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

// ── Experiment #5 — Series completion as sparklines ──────────────────────
//
// One row per series with 3+ known volumes. Sparkline is a horizontal
// strip of small cells, one per integer volume position from 1 to the
// maximum known. Cell states:
//   filled  → owned & in library
//   hollow  → catalogued (entry exists) but not owned
//   blank   → no entry — a gap in the user's catalog of the series
// Cell width scales to fit the strip's fixed pixel width so a 50-volume
// manga row and a 3-volume trilogy occupy the same visual budget; the
// count column on the right gives the absolute scale.

const COMPLETION_MIN_KNOWN = 3;
const COMPLETION_STRIP_W = 360;

function buildSeriesCompletion(rows) {
  if (!rows?.length) return [];
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.name)) groups.set(r.name, []);
    groups.get(r.name).push(r);
  }
  const out = [];
  for (const [name, books] of groups) {
    // Half-volumes (1.5, 2.5) merge into their floor for the cell grid
    // but still count toward owned/total totals. Most series are
    // integer-numbered; collapsing keeps the sparkline tidy.
    const byFloor = new Map();
    for (const b of books) {
      const k = Math.floor(b.position);
      const prior = byFloor.get(k);
      // If multiple books share a floor (e.g., 1 and 1.5), the cell is
      // owned if any of them is owned; status follows the owned one.
      if (!prior || (b.owned && !prior.owned)) byFloor.set(k, b);
    }
    const knownMax = Math.max(...books.map(b => Math.ceil(b.position)));
    const cells = [];
    for (let n = 1; n <= knownMax; n++) {
      const b = byFloor.get(n);
      cells.push({ n, book: b || null });
    }
    const ownedCount = books.filter(b => b.owned === 1 || b.owned === true).length;
    if (knownMax < COMPLETION_MIN_KNOWN) continue;
    out.push({ name, cells, knownMax, entryCount: books.length, ownedCount });
  }
  // Sort: near-complete sets first, then by length descending so longer
  // sparklines (more visual data) anchor each completion band.
  out.sort((a, b) =>
    (b.ownedCount / b.knownMax) - (a.ownedCount / a.knownMax) ||
    b.knownMax - a.knownMax ||
    a.name.localeCompare(b.name)
  );
  return out;
}

function CompletionRow({ name, cells, knownMax, ownedCount }) {
  const cellH = 14;
  const gap = 1;
  // Cell width derived from a shared strip width so rows of very
  // different knownMax can still be visually compared (a 7-cell row
  // and a 30-cell row occupy the same horizontal budget). Floor to
  // an integer pixel for crisp edges, minimum 2 to stay tappable.
  const cellW = Math.max(2, Math.floor((COMPLETION_STRIP_W - gap * (knownMax - 1)) / knownMax));
  const usedW = cellW * knownMax + gap * (knownMax - 1);

  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-56 shrink-0 truncate text-neutral-300" title={name}>
        {name}
      </div>
      <svg viewBox={`0 0 ${usedW} ${cellH}`} width={usedW} height={cellH} className="shrink-0">
        {cells.map(c => {
          const x = (c.n - 1) * (cellW + gap);
          if (!c.book) {
            // Gap — faint background so the position is still visible
            // as part of the series's run.
            return (
              <rect key={c.n} x={x} y={0} width={cellW} height={cellH} fill="#1a1816" rx={1}>
                <title>{`Vol. ${c.n} — no entry`}</title>
              </rect>
            );
          }
          const owned = c.book.owned === 1 || c.book.owned === true;
          const fill = owned ? '#b8896a' : 'transparent';
          const stroke = owned ? 'none' : '#525252';
          return (
            <rect
              key={c.n}
              x={x + 0.5}
              y={0.5}
              width={cellW - 1}
              height={cellH - 1}
              fill={fill}
              stroke={stroke}
              strokeWidth={owned ? 0 : 0.8}
              rx={1}
            >
              <title>{`Vol. ${c.n} — ${c.book.title}${owned ? '' : ' (not owned)'}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="ml-auto shrink-0 text-neutral-500 tabular-nums w-20 text-right">
        {ownedCount}/{knownMax} <span className="text-neutral-700">·</span> {Math.round((ownedCount / knownMax) * 100)}%
      </div>
    </div>
  );
}

// ── Experiment #6 — Year-published spectrum ──────────────────────────────
//
// Two-panel histogram of original year_published bucketed into decades,
// split at 1500 (the conventional early-modern boundary). Each panel
// uses its own y-scale so the BCE/medieval long tail isn't crushed by
// the modern-era pile — Tufte small multiples instead of a global
// linear scale that would make the pre-modern bars invisible. Bars are
// layered: muted neutral for the full library, warm parchment for the
// read subset on top.
const SPECTRUM_SPLIT = 1500;

function buildSpectrum(decadesPublished) {
  if (!decadesPublished?.length) return { allBins: [], minDecade: 0, maxDecade: 0 };
  const minDecade = Math.min(...decadesPublished.map(d => d.decade));
  const maxDecade = Math.max(...decadesPublished.map(d => d.decade));
  // Build a dense array with one slot per decade so empty centuries
  // still occupy visual space — the missing-data shape is itself data.
  const byDecade = new Map(decadesPublished.map(d => [d.decade, d]));
  const allBins = [];
  for (let d = minDecade; d <= maxDecade; d += 10) {
    const e = byDecade.get(d);
    allBins.push({ decade: d, count: e?.count || 0, read: e?.read || 0 });
  }
  return { allBins, minDecade, maxDecade };
}

function SpectrumPanel({ bins, panelMin, panelMax, tickStep, showLegend }) {
  const W = 1000, H = 200, TOP = 14, BOT = 22;
  const span = panelMax - panelMin + 10;
  const x = decade => ((decade - panelMin) / span) * W;
  const barW = (W / span) * 10 - 0.6;
  const visible = bins.filter(b => b.decade >= panelMin && b.decade <= panelMax);
  const dataMax = Math.max(1, ...visible.map(b => b.count));
  const yMax = Math.ceil(dataMax / 10) * 10;
  const y = v => H - (v / yMax) * H;

  const ticks = [];
  const start = Math.ceil(panelMin / tickStep) * tickStep;
  for (let t = start; t <= panelMax; t += tickStep) ticks.push(t);

  return (
    <svg viewBox={`0 0 ${W} ${H + TOP + BOT}`} className="w-full h-auto">
      <g transform={`translate(0, ${TOP})`}>
        {ticks.map(t => (
          <line key={`g-${t}`} x1={x(t)} y1={0} x2={x(t)} y2={H} stroke="#262626" strokeWidth={0.4} />
        ))}
        {visible.map(b => {
          if (b.count === 0) return null;
          return (
            <g key={b.decade}>
              <rect x={x(b.decade)} y={y(b.count)} width={barW} height={H - y(b.count)} fill="#525252">
                <title>{`${fmtYear(b.decade)}s — ${b.count} in library, ${b.read} read`}</title>
              </rect>
              {b.read > 0 && (
                <rect x={x(b.decade)} y={y(b.read)} width={barW} height={H - y(b.read)} fill="#d4a574">
                  <title>{`${fmtYear(b.decade)}s — ${b.count} in library, ${b.read} read`}</title>
                </rect>
              )}
            </g>
          );
        })}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#525252" strokeWidth={0.4} />
        {ticks.map(t => (
          <text key={`l-${t}`} x={x(t)} y={H + 12} fontSize="8" fill="#737373" textAnchor="middle">{fmtYear(t)}</text>
        ))}
        {/* Per-panel y-scale ceiling, top-left — names this panel's
            scale so the reader knows the panels aren't comparable
            vertically. */}
        <text x={0} y={-4} fontSize="9" fill="#737373">0–{yMax} books/decade</text>
        {showLegend && (
          <>
            <text x={W - 2} y={-4} fontSize="9" fill="#d4a574" textAnchor="end">read</text>
            <text x={W - 2} y={6} fontSize="9" fill="#a3a3a3" textAnchor="end">in library</text>
          </>
        )}
      </g>
    </svg>
  );
}

// ── Experiment #7 — Clouds (tags, authors) ─────────────────────────────
//
// Font *area* (size²) scales linearly with book_count, so doubling the
// count doubles the visual area on the page — lie factor ≈ 1.0 despite
// size being the encoding. Achieved by interpolating font-size in
// sqrt-space between a readable floor and a noticeable ceiling.
//
// Words are spiral-packed from the center outward, sorted by count desc
// so the heaviest entries land in the eye-catching middle and lighter
// entries fill the surround. Most words sit horizontal; a deterministic
// minority rotate 90° to mimic the irregular packing of a true word
// cloud. Color varies per item (deterministic by id) within a restrained
// palette.
//
// Trade-offs: size-as-magnitude remains imprecise for comparing
// non-adjacent values (Tufte's eraser test on a stock cloud asks what
// each non-data pixel earns). We accept the trade-off for visual
// texture and expose exact counts on hover; the Tags index page carries
// the precise sorted table for analytical reading.
const CLOUD_MIN_PX = 12;
const CLOUD_MAX_PX = 56;
const CLOUD_W = 800;
const CLOUD_H = 480;
const CLOUD_GAP = 5;
// Restrained palette of warm + cool accents chosen to stay within Spine's
// bookish range. Tag id mod palette length picks the color; small primes
// (× 17) decorrelate from id ordering so adjacent ids don't share hues.
const CLOUD_PALETTE = ['#d4a574', '#b8896a', '#8a5d37', '#a3a3a3', '#6b7d8a', '#7d6b8a'];

function buildCloud(items) {
  if (!items?.length) return [];
  const sorted = [...items].sort((a, b) => b.book_count - a.book_count);
  const minCount = sorted[sorted.length - 1].book_count;
  const maxCount = sorted[0].book_count;
  const sqrtMin = Math.sqrt(minCount);
  const sqrtMax = Math.sqrt(maxCount);
  const fontSize = t => {
    if (minCount === maxCount) return CLOUD_MAX_PX;
    const f = (Math.sqrt(t.book_count) - sqrtMin) / (sqrtMax - sqrtMin);
    return Math.round(CLOUD_MIN_PX + f * (CLOUD_MAX_PX - CLOUD_MIN_PX));
  };

  // Spiral-pack each word: try the center first, then walk outward along
  // an Archimedean spiral checking AABB collision against placed words.
  // Words placed first (heaviest) get prime real estate; smaller words
  // fill gaps. Conservative width estimate (0.55 × fontSize × len) keeps
  // adjacent words from kerning into each other.
  const cx = CLOUD_W / 2;
  const cy = CLOUD_H / 2;
  const placed = [];
  for (const t of sorted) {
    const fs = fontSize(t);
    // ~16% of words rotate 90°. Deterministic-by-id so the layout is
    // stable across re-renders. Larger tags (top 4) always horizontal so
    // the centerpiece reads cleanly.
    const isLarge = sorted.indexOf(t) < 4;
    const rotate = !isLarge && (t.id * 17) % 6 === 0 ? 90 : 0;
    const baseW = t.name.length * fs * 0.55 + CLOUD_GAP * 2;
    const baseH = fs * 1.1 + CLOUD_GAP * 2;
    const boxW = rotate === 90 ? baseH : baseW;
    const boxH = rotate === 90 ? baseW : baseH;
    const colorIdx = (t.id * 17) % CLOUD_PALETTE.length;
    const color = CLOUD_PALETTE[colorIdx];

    let spot = null;
    const MAX_ITERS = 2000;
    for (let i = 0; i < MAX_ITERS; i++) {
      // Archimedean spiral. step controls density; tuned so 56 tags pack
      // within an 800×480 viewport without huge gaps.
      const theta = 0.35 * Math.sqrt(i) * Math.PI * 2;
      const r = 5 * Math.sqrt(i);
      const x = cx + r * Math.cos(theta);
      const y = cy + r * Math.sin(theta);
      const x1 = x - boxW / 2, y1 = y - boxH / 2;
      const x2 = x + boxW / 2, y2 = y + boxH / 2;
      if (x1 < 0 || y1 < 0 || x2 > CLOUD_W || y2 > CLOUD_H) continue;
      let collides = false;
      for (const p of placed) {
        if (x1 < p.x2 && x2 > p.x1 && y1 < p.y2 && y2 > p.y1) { collides = true; break; }
      }
      if (!collides) { spot = { x, y, x1, y1, x2, y2 }; break; }
    }
    if (spot) {
      placed.push({ ...t, fontSize: fs, rotate, color, ...spot });
    }
    // else: skip — couldn't find a non-colliding spot within MAX_ITERS.
    // The skipped word is, by construction, one of the smallest (largest
    // were placed early when the canvas was empty).
  }
  return placed;
}

export default function DataViz() {
  // Single Promise.all fetch — all six panels share fate. The .then
  // shape-maps the array into a named object so the rest of the
  // component can keep destructuring `stats`/`calendar`/etc. directly
  // without `data[0]` indexing.
  const { data, loading, error } = useFreshFetch(
    () => Promise.all([
      api.getStats(),
      api.getReadingCalendar(),
      api.getAuthors(),
      api.getLibraryTrajectory(),
      api.getSeriesCompletion(),
      api.getTags(),
    ]).then(([s, c, a, t, sc, tg]) => ({
      stats: s, calendar: c, authors: a, trajectory: t, completion: sc, tags: tg,
    })),
    [],
  );
  const stats      = data?.stats;
  const calendar   = data?.calendar;
  const authors    = data?.authors;
  const trajectory = data?.trajectory;
  const completion = data?.completion;
  const tags       = data?.tags;

  // Experiment #5 tab: 'in_progress' (partial-completion sparklines) or
  // 'complete' (series the user owns 100% of, where the sparkline shape
  // collapses to all-filled and the row carries no comparative info).
  const [completionTab, setCompletionTab] = useState('in_progress');
  const completionTabRefs = useRef([]);

  function handleCompletionTabKey(e, idx) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = (idx + dir + COMPLETION_TABS.length) % COMPLETION_TABS.length;
      setCompletionTab(COMPLETION_TABS[next].key);
      completionTabRefs.current[next]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCompletionTab(COMPLETION_TABS[0].key);
      completionTabRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setCompletionTab(COMPLETION_TABS[COMPLETION_TABS.length - 1].key);
      completionTabRefs.current[COMPLETION_TABS.length - 1]?.focus();
    }
  }

  const acq = useMemo(
    () => buildAcquisitionPanels(stats?.acquiredByYearAndSource),
    [stats],
  );
  const cal = useMemo(() => buildCalendar(calendar), [calendar]);
  const life = useMemo(() => buildLifespans(authors), [authors]);
  const comp = useMemo(() => buildSeriesCompletion(completion), [completion]);
  // Partition series into "fully owned" (every known volume in the
  // library) vs "in progress" (at least one gap or unowned entry).
  // Sorted order is preserved within each bucket.
  const compSplit = useMemo(() => {
    const inProgress = [], complete = [];
    for (const s of comp) {
      if (s.ownedCount >= s.knownMax) complete.push(s);
      else inProgress.push(s);
    }
    return { inProgress, complete };
  }, [comp]);
  const spec = useMemo(() => buildSpectrum(stats?.decadesPublished), [stats]);
  const cloud = useMemo(() => buildCloud(tags), [tags]);
  // Authors cloud — capped at top 40 by book_count so the spiral pack
  // can find non-colliding slots within an 800×480 canvas. The long
  // tail (454 single-book authors) is the wrong shape for a cloud.
  const authorCloud = useMemo(() => {
    if (!authors) return [];
    const top = [...authors]
      .filter(a => (a.book_count || 0) > 0)
      .sort((a, b) => b.book_count - a.book_count)
      .slice(0, 40);
    return buildCloud(top);
  }, [authors]);

  if (error) return <div role="alert" className="text-warn text-sm">Failed to load data.</div>;
  if (loading) return <div role="status" className="text-neutral-700 text-sm">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-12">
      <PageHeading>Data visualization</PageHeading>

      {/* ── Experiment #1 — Acquisitions by source ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #1 — Acquisitions by source</span>, {acq.years[0]}–{acq.years[acq.years.length - 1]}. Small multiples with a shared y-scale ({acq.yMax}/yr ceiling), so the eye can compare each source's tempo against the others. Top {TOP_N_SOURCES} sources by total; everything else collapses into the Other panel.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
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
          <span className="text-neutral-300 font-semibold">Experiment #3 — Authors as lifespans</span>, {fmtYear(life.minY)} – {fmtYear(life.maxY)}. {life.rows.length} authors with both birth and death dates; rows sorted oldest birth first. Each bar spans an author's life; the dot at the midpoint is sized by books-in-library (sqrt scale, max {life.maxBooks}). Top authors by count are labelled inline; more labels surface at higher zoom. Use the − / + buttons to scale the chart uniformly — at zoom &gt; 1× a horizontal scrollbar appears so the time axis stretches out rather than compacting against the container.
        </p>
        <LifespansWithLoupe {...life} />
      </section>

      {/* ── Experiment #4 — Cumulative acquired vs finished ── */}
      {trajectory.length > 0 && (
        <section className="space-y-4">
          <p className="text-sm text-neutral-500">
            <span className="text-neutral-300 font-semibold">Experiment #4 — Cumulative acquired vs finished</span>, {trajectory[0].month} – {trajectory[trajectory.length - 1].month}. Two monthly running totals overlaid; the shaded area between them is the to-read mountain. Only date-stamped finishes count toward the lower line, so the gap reflects both unread inventory and books finished without a recorded date. (Audit's "Owned books have finish date" gap shows the books missing a date.)
          </p>
          <TrajectoryChart data={trajectory} />
        </section>
      )}

      {/* ── Experiment #5 — Series completion as sparklines ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #5 — Series completion sparklines</span>. {comp.length} series with {COMPLETION_MIN_KNOWN}+ known volumes. Each cell is one volume — filled if owned, hollow outline if catalogued-but-not-owned, faint background if no entry. Strip width is shared across all rows so a 30-volume manga and a 3-volume trilogy occupy the same horizontal budget; the count column on the right gives the absolute scale. Two tabs: in-progress sets (where the sparkline still carries shape information) and fully-owned sets (which read as a solid strip).
        </p>
        <div role="tablist" aria-label="Series completion view" className="flex gap-1 bg-neutral-900 p-1 rounded-lg w-fit">
          {COMPLETION_TABS.map((t, i) => {
            const count = t.key === 'in_progress' ? compSplit.inProgress.length : compSplit.complete.length;
            const active = completionTab === t.key;
            return (
              <button
                key={t.key}
                ref={el => { completionTabRefs.current[i] = el; }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setCompletionTab(t.key)}
                onKeyDown={e => handleCompletionTabKey(e, i)}
                className={`px-4 py-1.5 text-xs rounded-md whitespace-nowrap transition-[transform,background-color,color] ease-out duration-150 motion-safe:active:scale-[0.98] ${
                  active
                    ? 'bg-binding/25 text-parchment font-semibold'
                    : 'font-medium text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t.label}<span className="ml-1.5 opacity-50 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="space-y-1.5">
          {(completionTab === 'complete' ? compSplit.complete : compSplit.inProgress).map(s => (
            <CompletionRow key={s.name} {...s} />
          ))}
        </div>
      </section>

      {/* ── Experiment #6 — Year-published spectrum ── */}
      {spec.allBins.length > 0 && (
        <section className="space-y-4">
          <p className="text-sm text-neutral-500">
            <span className="text-neutral-300 font-semibold">Experiment #6 — Year-published spectrum</span>, {fmtYear(spec.minDecade)} – {fmtYear(spec.maxDecade)}. Decade-binned histogram of every book's original publication year, split into two panels at {fmtYear(SPECTRUM_SPLIT)} — the conventional early-modern divide and your library's natural regime shift (pre-1500 mostly 1–10 books/decade, post-1500 mostly 20+). Each panel uses its own y-scale so the long tail doesn't get crushed by the modern pile; bars are layered with muted neutral for all books in the library and warm parchment for the read subset on top.
          </p>
          {/* Each panel only renders if its date range actually contains
              data — otherwise panelMin > panelMax inverts the SVG. */}
          {spec.minDecade <= 1490 && (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Pre-modern · {fmtYear(spec.minDecade)} – 1490s</div>
              <SpectrumPanel bins={spec.allBins} panelMin={spec.minDecade} panelMax={1490} tickStep={250} showLegend={true} />
            </div>
          )}
          {spec.maxDecade >= 1500 && (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Modern · 1500s – {fmtYear(spec.maxDecade)}s</div>
              <SpectrumPanel bins={spec.allBins} panelMin={1500} panelMax={spec.maxDecade} tickStep={100} showLegend={false} />
            </div>
          )}
        </section>
      )}

      {/* ── Experiment #7 — Clouds ── */}
      {(cloud.length > 0 || authorCloud.length > 0) && (
        <section className="space-y-4">
          <p className="text-sm text-neutral-500">
            <span className="text-neutral-300 font-semibold">Experiment #7 — Clouds</span>. Font area (size²) scales linearly with book_count via sqrt-space interpolation, so a doubled count gives double visual area — lie factor ≈ 1. Words spiral-pack from the center outward, heaviest first, with a deterministic minority rotated 90° for cloud texture. Size is imprecise for comparing non-adjacent words (the inherent cloud trade-off) — hover for the exact count, click to browse. For analytical reading the Tags and Authors index pages give the precise sorted tables.
          </p>
          {cloud.length > 0 && (
            <svg viewBox={`0 0 ${CLOUD_W} ${CLOUD_H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
              {cloud.map(t => (
                <Link
                  key={t.id}
                  to={`/browse/tag/${encodeURIComponent(t.name)}`}
                  state={FROM_DV}
                >
                  <text
                    x={t.x}
                    y={t.y}
                    fontSize={t.fontSize}
                    fill={t.color}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={t.rotate ? `rotate(${t.rotate} ${t.x} ${t.y})` : undefined}
                    className="cursor-pointer transition-opacity hover:opacity-70"
                    fontWeight="500"
                  >
                    <title>{`${t.name} · ${t.book_count} ${t.book_count === 1 ? 'book' : 'books'}`}</title>
                    {t.name}
                  </text>
                </Link>
              ))}
            </svg>
          )}
          {authorCloud.length > 0 && (
            <svg viewBox={`0 0 ${CLOUD_W} ${CLOUD_H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
              {authorCloud.map(a => (
                <Link
                  key={a.id}
                  to={`/authors/${a.id}`}
                  state={FROM_DV}
                >
                  <text
                    x={a.x}
                    y={a.y}
                    fontSize={a.fontSize}
                    fill={a.color}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={a.rotate ? `rotate(${a.rotate} ${a.x} ${a.y})` : undefined}
                    className="cursor-pointer transition-opacity hover:opacity-70"
                    fontWeight="500"
                  >
                    <title>{`${a.name} · ${a.book_count} ${a.book_count === 1 ? 'book' : 'books'}`}</title>
                    {a.name}
                  </text>
                </Link>
              ))}
            </svg>
          )}
        </section>
      )}

    </div>
  );
}
