import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

// Top N sources get their own panel; everything else collapses into
// "Other" so the long tail of single-source bookstores doesn't drown
// out the comparison. 3 isolates the dominant Kindle / Audible / Amazon
// trio against an Other bucket; the four panels lay out as a 2x2 grid.
const TOP_N_SOURCES = 3;

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
    // Surface the rolled-up source names so the Other panel can carry a
    // hover-revealed list — the (N) count alone is opaque. Sorted by
    // total descending so the most-frequent rolled-up source reads first.
    const otherSources = rest.map(([s, t]) => `${s} (${t})`);
    panels.push({
      source: `Other (${rest.length})`,
      total: otherTotal,
      values: years.map(y => otherCells.get(y) || 0),
      sources: otherSources,
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
// spans only the active data extent, not a padded margin); y-scale
// label is suppressed (it's the same on every panel — shared scale is
// the whole point of a small-multiples display, and printing the same
// number on every panel would fail the eraser test). The peak bar
// carries an inline year·count label so the eye gets a numeric anchor
// without hovering; intermediate year ticks at 5-year boundaries help
// locate when each panel's spike happened. For the "Other" panel, the
// header span carries a native `title` listing the rolled-up sources.
function AcquisitionPanel({ source, total, values, years, yMax, sources }) {
  const W = 200, H = 60, FOOT = 12;
  const n = values.length;
  const gap = 1;
  const barW = (W - gap * (n - 1)) / n;
  const xCenterOf = i => i * (barW + gap) + barW / 2;

  // Peak detection — first occurrence of the max wins ties so the label
  // doesn't jump around if two years share a maximum.
  let peakIdx = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[peakIdx]) peakIdx = i;
  const peakValue = values[peakIdx];

  // Intermediate year ticks at multiples of 5 falling strictly between
  // first and last year — the edges already carry their own labels and
  // a redundant 2010 next to 2010 would fail the eraser test.
  const intermediateTicks = years
    .map((y, i) => ({ year: Number(y), i }))
    .filter(t => t.year % 5 === 0 && t.i !== 0 && t.i !== years.length - 1);

  // Peak label horizontal anchoring — center the label by default, but
  // align to start/end if the peak sits near the panel's edges so the
  // text doesn't run off the chart.
  const peakAnchor = peakIdx < 3 ? 'start' : peakIdx > years.length - 4 ? 'end' : 'middle';
  const peakX = xCenterOf(peakIdx);
  const peakLabelX = peakAnchor === 'start' ? peakX - barW / 2
                   : peakAnchor === 'end'   ? peakX + barW / 2
                                            : peakX;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span
          className="font-semibold text-parchment"
          title={sources ? sources.join('\n') : undefined}
        >
          {source}
        </span>
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
        {/* Peak annotation — small lighter-toned label just above the
            tallest bar, identifying the year and count in one mark. */}
        {peakValue > 0 && (
          <text
            x={peakLabelX}
            y={H - (peakValue / yMax) * H - 1.5}
            fontSize="6"
            fill="#d4a574"
            textAnchor={peakAnchor}
          >
            {`${years[peakIdx]}·${peakValue}`}
          </text>
        )}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#525252" strokeWidth={0.4} />
        <text x={0} y={H + FOOT - 2} fontSize="6" fill="#737373">{years[0]}</text>
        {intermediateTicks.map(t => (
          <text
            key={`yt-${t.year}`}
            x={xCenterOf(t.i)}
            y={H + FOOT - 2}
            fontSize="6"
            fill="#737373"
            textAnchor="middle"
          >
            {t.year}
          </text>
        ))}
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

// ── Experiment #9 — Dot-dash plot: page count × rating ───────────────────
//
// Canonical Tufte dot-dash plot from Visual Display: the scatter shows
// each rated book at (page_count, rating); the axes are replaced by
// marginal rug plots so the same ink that serves as the frame also
// shows the 1D distribution of each variable. Dots are coloured by
// format — physical / ebook / audiobook — as a third variable layered
// onto the same display.

const FORMAT_COLOR = {
  physical:  '#d4a574',
  ebook:     '#8aa6b8',
  audiobook: '#c47853',
};

function buildDotDash(rows) {
  if (!rows?.length) return { rows: [], xMax: 0, ratings: [] };
  const xMax = Math.max(...rows.map(r => r.page_count));
  const ratings = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  return { rows, xMax, ratings };
}

function DotDashPlot({ rows, xMax, ratings }) {
  // Round the x-axis ceiling to a clean tick. The actual data may go to
  // 4958; rounding up to the next 1000 gives a labelable extent.
  const xCeiling = Math.ceil(xMax / 1000) * 1000;
  const W = 620, H = 380;
  const M = { top: 20, right: 16, bottom: 36, left: 50 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const x = pages => M.left + (pages / xCeiling) * plotW;
  const y = rating => M.top + plotH - ((rating - 0.5) / (5 - 0.5)) * plotH;

  // x-axis tick positions (every 1000) for axis labels.
  const xTicks = [];
  for (let t = 0; t <= xCeiling; t += 1000) xTicks.push(t);

  // Median lines — light reference dashes so the eye finds the centre
  // of mass without needing to compute it. Pure analytic-design layer.
  const sortedX = [...rows].map(r => r.page_count).sort((a, b) => a - b);
  const sortedY = [...rows].map(r => r.rating).sort((a, b) => a - b);
  const medianX = sortedX[Math.floor(sortedX.length / 2)];
  const medianY = sortedY[Math.floor(sortedY.length / 2)];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Median guide lines — very faint dashed, recede behind data. */}
      <line x1={x(medianX)} y1={M.top} x2={x(medianX)} y2={M.top + plotH} stroke="#404040" strokeWidth={0.4} strokeDasharray="2 2" />
      <line x1={M.left} y1={y(medianY)} x2={M.left + plotW} y2={y(medianY)} stroke="#404040" strokeWidth={0.4} strokeDasharray="2 2" />

      {/* Bottom rug — each book's page_count as a small vertical tick on
          the bottom margin. This IS the x-axis: same ink shows both the
          axis baseline (collectively) and the 1D distribution. */}
      {rows.map(r => (
        <line
          key={`rb-${r.id}`}
          x1={x(r.page_count)} x2={x(r.page_count)}
          y1={M.top + plotH + 1}
          y2={M.top + plotH + 6}
          stroke="#737373" strokeWidth={0.5}
        />
      ))}
      {/* Left rug — each book's rating as a small horizontal tick on the
          left margin. Same role: axis + marginal distribution in one. */}
      {rows.map(r => (
        <line
          key={`rl-${r.id}`}
          y1={y(r.rating)} y2={y(r.rating)}
          x1={M.left - 6}
          x2={M.left - 1}
          stroke="#737373" strokeWidth={0.5}
        />
      ))}

      {/* x-axis tick labels — small, neutral. */}
      {xTicks.map(t => (
        <text key={`xt-${t}`} x={x(t)} y={M.top + plotH + 18} fontSize="8" fill="#737373" textAnchor="middle">
          {t === 0 ? '0' : `${t / 1000}k`}
        </text>
      ))}
      {/* y-axis labels — at integer ratings only, sparser to avoid clutter. */}
      {[1, 2, 3, 4, 5].map(r => (
        <text key={`yt-${r}`} x={M.left - 10} y={y(r) + 3} fontSize="8" fill="#737373" textAnchor="end">{r}</text>
      ))}
      {/* Axis names — small, oriented for readability. */}
      <text x={M.left + plotW / 2} y={H - 4} fontSize="9" fill="#a3a3a3" textAnchor="middle">Page count</text>
      <text x={12} y={M.top + plotH / 2} fontSize="9" fill="#a3a3a3" textAnchor="middle" transform={`rotate(-90 12 ${M.top + plotH / 2})`}>Rating</text>

      {/* Data points — small circles, semi-transparent so cluster density
          becomes its own encoding via overlap. */}
      {rows.map(r => (
        <circle
          key={r.id}
          cx={x(r.page_count)}
          cy={y(r.rating)}
          r={3.5}
          fill={FORMAT_COLOR[r.format] || '#a3a3a3'}
          fillOpacity={0.75}
        >
          <title>{`${r.title} · ${r.page_count} p · ${r.rating}★ · ${r.format}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function FormatLegend() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-neutral-500">
      {Object.entries(FORMAT_COLOR).map(([fmt, color]) => (
        <div key={fmt} className="flex items-center gap-1.5">
          <svg width="10" height="10"><circle cx="5" cy="5" r="3.5" fill={color} fillOpacity={0.75} /></svg>
          <span className="text-neutral-400">{fmt}</span>
        </div>
      ))}
      <span className="ml-2 text-neutral-700">· dashed lines mark medians</span>
    </div>
  );
}

// ── Experiment #10 — Acquisition→finish Marey, per book ──────────────────
//
// One row per dated-finish book, horizontal bar spans acquisition_date
// to date_finished. Sorted by acquisition date (oldest at top) so the
// visual flow shows how reading tempo tracks acquisition tempo. The
// bar length encodes the lag for that specific book; year-boundary
// verticals carry the time axis. Companion to #3's author-level
// lifespan timeline, scaled down to book-level events.

// Pad partial acquisition dates to a julian-day-friendly form (mirrors
// the same fallback the reading-lag SQL uses), then return a Date.
function parseAcquisitionDate(s) {
  if (!s) return null;
  if (s.length >= 10) return new Date(s);
  if (s.length === 7) return new Date(s + '-15');
  if (s.length === 4) return new Date(s + '-07-01');
  return null;
}

function buildBookMarey(rows) {
  if (!rows?.length) return { rows: [], minMs: 0, maxMs: 0, years: [] };
  const enriched = rows
    .map(r => ({
      ...r,
      acqMs: parseAcquisitionDate(r.acquisition_date)?.getTime(),
      finMs: new Date(r.date_finished).getTime(),
    }))
    .filter(r => r.acqMs && r.finMs);
  enriched.sort((a, b) => a.acqMs - b.acqMs || a.finMs - b.finMs);
  const minMs = Math.min(...enriched.map(r => r.acqMs));
  const maxMs = Math.max(...enriched.map(r => r.finMs));
  const startYear = new Date(minMs).getFullYear();
  const endYear = new Date(maxMs).getFullYear();
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);
  return { rows: enriched, minMs, maxMs, years };
}

function BookMareyChart({ rows, minMs, maxMs, years }) {
  const W = 1000, ROW_H = 3.5, TOP = 18, BOT = 18;
  const H = rows.length * ROW_H;
  const xOfMs = ms => ((ms - minMs) / (maxMs - minMs)) * W;
  const xOfYear = y => xOfMs(new Date(`${y}-01-01`).getTime());

  // Pick 5 longest-lag books for inline labels — these are the
  // visually-dominant horizontal sweeps, and labelling them ties the
  // shape to specific volumes (analytical-design: integrate words +
  // data, don't relegate identification to a separate legend).
  const labelSet = new Set(
    [...rows].sort((a, b) => b.lag_days - a.lag_days).slice(0, 5).map(r => r.id)
  );

  return (
    <svg viewBox={`0 0 ${W} ${H + TOP + BOT}`} className="w-full h-auto">
      <g transform={`translate(0, ${TOP})`}>
        {/* Year-boundary verticals through the whole frame. Faint enough
            that the bars dominate; present enough to give every event
            a temporal anchor. */}
        {years.map(y => (
          <line key={`y-${y}`} x1={xOfYear(y)} y1={0} x2={xOfYear(y)} y2={H} stroke="#262626" strokeWidth={0.4} />
        ))}
        {/* Year labels at the top (alternating to avoid crowding when
            the span is dense). */}
        {years.filter((_, i) => i % 2 === 0).map(y => (
          <text key={`yl-${y}`} x={xOfYear(y)} y={-6} fontSize="8" fill="#737373" textAnchor="middle">{y}</text>
        ))}
        {/* Per-book bars — bar length is the lag, position is when the
            event happened in the library's lifetime. */}
        {rows.map((r, i) => {
          const y = i * ROW_H + ROW_H / 2;
          const x1 = xOfMs(r.acqMs);
          const x2 = xOfMs(r.finMs);
          const isLabel = labelSet.has(r.id);
          return (
            <g key={r.id}>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke="#8a5d37" strokeWidth={1.4}>
                <title>{`${r.title}\nacquired ${r.acquisition_date} → finished ${r.date_finished}\n${Math.round(r.lag_days)} days`}</title>
              </line>
              {/* End-cap dot at finish, to read the right edge as the
                  completion event (not just a bar termination). */}
              <circle cx={x2} cy={y} r={1.2} fill="#d4a574" />
              {isLabel && (
                <text x={x2 + 3} y={y + 1.5} fontSize="6" fill="#d4d4d8">
                  {r.title} ({Math.round(r.lag_days)}d)
                </text>
              )}
            </g>
          );
        })}
        {/* Range-framed baseline + footer ticks for the every-2-years
            labels. */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#525252" strokeWidth={0.4} />
        {years.filter((_, i) => i % 2 === 0).map(y => (
          <text key={`yf-${y}`} x={xOfYear(y)} y={H + 11} fontSize="8" fill="#737373" textAnchor="middle">{y}</text>
        ))}
      </g>
    </svg>
  );
}

// ── Experiment #8 — Reading-lag distribution ─────────────────────────────
//
// Histogram of per-book days between acquisition and finish, bucketed
// on a roughly log scale so the fast-and-slow tails both get readable
// resolution. Tufte data-table form: bin label, embedded sparkline
// bar, count — words, numbers, and image in a single integrated row
// (analytical-design principle 4).

const LAG_BINS = [
  { label: 'Same day / next',    min: 0,    max: 1     },
  { label: 'This week',          min: 2,    max: 7     },
  { label: 'This month',         min: 8,    max: 30    },
  { label: 'This quarter',       min: 31,   max: 90    },
  { label: 'This year',          min: 91,   max: 365   },
  { label: '1–3 years',          min: 366,  max: 1095  },
  { label: '3+ years',           min: 1096, max: Infinity },
];

function buildReadingLag(rows) {
  if (!rows?.length) return { bins: [], total: 0, median: 0, mean: 0, fastest: null, slowest: null };
  const bins = LAG_BINS.map(b => ({ ...b, count: 0, books: [] }));
  for (const r of rows) {
    if (r.lag_days < 0) continue;
    const bin = bins.find(b => r.lag_days >= b.min && r.lag_days <= b.max);
    if (bin) {
      bin.count++;
      bin.books.push(r);
    }
  }
  const lags = rows.map(r => r.lag_days).filter(v => v >= 0).sort((a, b) => a - b);
  const n = lags.length;
  const median = n === 0 ? 0 : (n % 2 ? lags[(n - 1) / 2] : (lags[n / 2 - 1] + lags[n / 2]) / 2);
  const mean = n === 0 ? 0 : lags.reduce((a, b) => a + b, 0) / n;
  const fastest = rows[0];
  const slowest = rows[rows.length - 1];
  return { bins, total: n, median, mean, fastest, slowest };
}

function fmtDays(d) {
  if (d < 1)    return '<1 day';
  if (d < 30)   return `${Math.round(d)} days`;
  if (d < 365)  return `${Math.round(d / 30)} months`;
  return `${(d / 365).toFixed(1)} years`;
}

function LagHistogram({ bins, total, median, mean }) {
  const maxCount = Math.max(...bins.map(b => b.count));
  const W = 600, ROW_H = 18, gap = 4;
  const labelW = 140, barW = 380, countW = 50;
  const innerH = ROW_H - gap;

  // Identify which bin contains the median — we annotate it with a
  // pointer so the central tendency is read directly off the
  // distribution shape, not just from the caption above.
  const medianBinIdx = bins.findIndex(b => median >= b.min && median <= b.max);

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-neutral-500 tabular-nums">
        <span className="text-neutral-300">{total} dated finishes</span> · median <span className="text-neutral-300">{fmtDays(median)}</span> · mean <span className="text-neutral-300">{fmtDays(mean)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${bins.length * ROW_H}`} className="w-full h-auto" preserveAspectRatio="none">
        {bins.map((b, i) => {
          const y = i * ROW_H;
          const barFill = b.count > 0 ? (b.count / maxCount) * barW : 0;
          const tip = b.books
            .slice(0, 5)
            .map(bk => `${bk.title} (${Math.round(bk.lag_days)}d)`)
            .join('\n');
          return (
            <g key={b.label}>
              {/* Bin label, right-aligned for tidy parallelism with the bar starts. */}
              <text x={labelW} y={y + innerH - 3} fontSize="9" fill="#d4d4d8" textAnchor="end">{b.label}</text>
              {/* Bar — single rectangle, parchment fill. No grid, no axis;
                  the embedded count to the right is the scale. */}
              <rect x={labelW + 6} y={y + 2} width={barFill} height={innerH - 4} fill="#b8896a">
                <title>{`${b.label} (${b.min}–${b.max === Infinity ? '∞' : b.max} days) — ${b.count} books${tip ? '\n\n' + tip : ''}`}</title>
              </rect>
              {/* Count column. */}
              <text x={labelW + 6 + barW + 6} y={y + innerH - 3} fontSize="9" fill="#737373" textAnchor="start">{b.count}</text>
              {/* Median pointer — small ◂ at the right edge of the
                  containing bin's bar, so the typical-lag bin is
                  visually flagged inside the histogram. */}
              {i === medianBinIdx && (
                <text x={labelW + 6 + barFill + 2} y={y + innerH - 3} fontSize="8" fill="#d4a574">◂ median</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Experiment #7 — Tags × decade heatmap ────────────────────────────────
//
// Matrix of subject tag (rows, sorted by total) against publication
// decade (columns, full BCE→present span). Cell shade encodes the
// per-cell book count, thresholded into 6 bands so the BCE wisps stay
// visible alongside the dense 20th-century pile. Light cells recede,
// dense ones dominate — pure Tufte layering in matrix form, no grid
// lines (the cells imply the grid).

const TAG_MIN_TOTAL = 5;
// Asymmetric thresholds: more resolution at the low end where ancient
// decades cluster, fewer bands up top where the 2010s pile dominates.
const HEAT_BUCKETS = [
  { max: 0,  color: '#1a1816' }, // 0
  { max: 1,  color: '#3a2c1f' }, // 1
  { max: 4,  color: '#5a4029' }, // 2-4
  { max: 14, color: '#8a5d37' }, // 5-14
  { max: 39, color: '#b8896a' }, // 15-39
  { max: Infinity, color: '#d4a574' }, // 40+
];

function heatColor(count) {
  for (const b of HEAT_BUCKETS) if (count <= b.max) return b.color;
  return HEAT_BUCKETS[HEAT_BUCKETS.length - 1].color;
}

function buildTagDecade(rows) {
  if (!rows?.length) return { tags: [], decades: [], grid: new Map(), minDecade: 0, maxDecade: 0 };
  const byTag = new Map();
  let minDecade = Infinity, maxDecade = -Infinity;
  for (const r of rows) {
    if (!byTag.has(r.tag)) byTag.set(r.tag, { total: 0, byDecade: new Map() });
    const entry = byTag.get(r.tag);
    entry.total += r.count;
    entry.byDecade.set(r.decade, r.count);
    if (r.decade < minDecade) minDecade = r.decade;
    if (r.decade > maxDecade) maxDecade = r.decade;
  }
  const tags = Array.from(byTag.entries())
    .filter(([, e]) => e.total >= TAG_MIN_TOTAL)
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .map(([name, e]) => ({ name, total: e.total, byDecade: e.byDecade }));
  const decades = [];
  for (let d = minDecade; d <= maxDecade; d += 10) decades.push(d);
  return { tags, decades, minDecade, maxDecade };
}

function TagDecadeMatrix({ tags, decades, minDecade, maxDecade }) {
  const cellW = 3, cellH = 11, gap = 0.5;
  const gridW = decades.length * (cellW + gap) - gap;
  const labelW = 130;
  const totalW = 36;
  const W = labelW + gridW + totalW + 14; // 14 = 6 + 8 gutters
  const H = tags.length * (cellH + gap) - gap + 22; // 22 = bottom decade-label strip

  // Tick lines at 250-year intervals so the eye can anchor decades.
  const ticks = [];
  const start = Math.ceil(minDecade / 250) * 250;
  for (let t = start; t <= maxDecade; t += 250) ticks.push(t);

  const xOfDecade = d => labelW + 6 + ((d - minDecade) / 10) * (cellW + gap);
  const gridH = tags.length * (cellH + gap) - gap;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* Quiet vertical references through the grid at the labelled ticks. */}
      {ticks.map(t => (
        <line key={`g-${t}`} x1={xOfDecade(t)} y1={0} x2={xOfDecade(t)} y2={gridH} stroke="#262626" strokeWidth={0.4} />
      ))}
      {tags.map((tag, ri) => {
        const y = ri * (cellH + gap);
        return (
          <g key={tag.name}>
            <text x={labelW} y={y + cellH - 2} fontSize="8" fill="#d4d4d8" textAnchor="end">{tag.name}</text>
            {decades.map((d, ci) => {
              const c = tag.byDecade.get(d) || 0;
              return (
                <rect
                  key={d}
                  x={labelW + 6 + ci * (cellW + gap)}
                  y={y}
                  width={cellW}
                  height={cellH}
                  fill={heatColor(c)}
                >
                  {c > 0 && <title>{`${tag.name} — ${fmtYear(d)}s — ${c} book${c === 1 ? '' : 's'}`}</title>}
                </rect>
              );
            })}
            <text x={labelW + 6 + gridW + 4} y={y + cellH - 2} fontSize="8" fill="#737373" textAnchor="start">{tag.total}</text>
          </g>
        );
      })}
      {/* Decade-axis labels at the tick positions, below the grid. */}
      {ticks.map(t => (
        <text key={`l-${t}`} x={xOfDecade(t)} y={gridH + 12} fontSize="8" fill="#737373" textAnchor="middle">{fmtYear(t)}</text>
      ))}
    </svg>
  );
}

function HeatLegend() {
  const size = 12, gap = 2;
  const W = HEAT_BUCKETS.length * (size + gap) - gap;
  const labels = ['0', '1', '2-4', '5-14', '15-39', '40+'];
  return (
    <div className="flex items-center gap-2 text-[10px] text-neutral-500">
      <span>Fewer</span>
      <svg viewBox={`0 0 ${W} ${size + 10}`} width={W} height={size + 10}>
        {HEAT_BUCKETS.map((b, i) => (
          <g key={i}>
            <rect x={i * (size + gap)} y={0} width={size} height={size} fill={b.color} rx={1} />
            <text x={i * (size + gap) + size / 2} y={size + 8} fontSize="6" fill="#737373" textAnchor="middle">{labels[i]}</text>
          </g>
        ))}
      </svg>
      <span>More books per (tag, decade)</span>
    </div>
  );
}

// ── Experiment #6 — Year-published spectrum ──────────────────────────────
//
// Histogram of original year_published bucketed into decades, layered:
// the full library in muted neutral, books-actually-read in warm
// parchment on top. The visible gap between the two bars in any decade
// is what's in the library but unread for that era.
//
// Linear time axis on purpose — the sparse BCE/medieval span IS the
// data shape, and shrink-fitting it would hide that. Centuries get
// faint vertical references; CE/BCE labels at common landmarks.

function buildSpectrum(decadesPublished) {
  if (!decadesPublished?.length) return { bins: [], minDecade: 0, maxDecade: 0, yMax: 0 };
  const minDecade = Math.min(...decadesPublished.map(d => d.decade));
  const maxDecade = Math.max(...decadesPublished.map(d => d.decade));
  // Build a dense array with one slot per decade so empty centuries
  // still occupy visual space — the missing-data shape is itself data.
  const byDecade = new Map(decadesPublished.map(d => [d.decade, d]));
  const bins = [];
  for (let d = minDecade; d <= maxDecade; d += 10) {
    const e = byDecade.get(d);
    bins.push({ decade: d, count: e?.count || 0, read: e?.read || 0 });
  }
  const yMax = Math.max(...bins.map(b => b.count));
  return { bins, minDecade, maxDecade, yMax };
}

function SpectrumChart({ bins, minDecade, maxDecade, yMax }) {
  const W = 1000, H = 200, TOP = 14, BOT = 22;
  const span = maxDecade - minDecade + 10;
  const x = decade => ((decade - minDecade) / span) * W;
  const barW = (W / span) * 10 - 0.6; // 10 years wide, small inset for gap
  const y = v => H - (v / yMax) * H;

  // Century tick lines + labels at 250-year intervals. fmtYear gives the
  // BCE/CE qualifier; the axis label is the only place the era is named.
  const ticks = [];
  const start = Math.ceil(minDecade / 250) * 250;
  for (let t = start; t <= maxDecade; t += 250) ticks.push(t);

  return (
    <svg viewBox={`0 0 ${W} ${H + TOP + BOT}`} className="w-full h-auto">
      <g transform={`translate(0, ${TOP})`}>
        {/* Century reference verticals — quiet, behind the bars. */}
        {ticks.map(t => (
          <line key={`g-${t}`} x1={x(t)} y1={0} x2={x(t)} y2={H} stroke="#262626" strokeWidth={0.4} />
        ))}
        {/* Bars: total in neutral first, then read on top in parchment.
            Drawn-in-this-order matters; the read bar layers OVER the
            total so its top edge is what the eye reads as "owned but
            not yet read" boundary. */}
        {bins.map(b => {
          if (b.count === 0) return null;
          return (
            <g key={b.decade}>
              <rect
                x={x(b.decade)}
                y={y(b.count)}
                width={barW}
                height={H - y(b.count)}
                fill="#525252"
              >
                <title>{`${fmtYear(b.decade)}s — ${b.count} in library, ${b.read} read`}</title>
              </rect>
              {b.read > 0 && (
                <rect
                  x={x(b.decade)}
                  y={y(b.read)}
                  width={barW}
                  height={H - y(b.read)}
                  fill="#d4a574"
                >
                  <title>{`${fmtYear(b.decade)}s — ${b.count} in library, ${b.read} read`}</title>
                </rect>
              )}
            </g>
          );
        })}
        {/* Range-framed baseline. */}
        <line x1={0} y1={H} x2={W} y2={H} stroke="#525252" strokeWidth={0.4} />
        {/* Tick labels under the plot. */}
        {ticks.map(t => (
          <text key={`l-${t}`} x={x(t)} y={H + 12} fontSize="8" fill="#737373" textAnchor="middle">{fmtYear(t)}</text>
        ))}
        {/* Endpoint hint at the right — what the warm overlay means.
            Direct attribution where the data lives, no separate legend. */}
        <text x={W - 2} y={-4} fontSize="9" fill="#d4a574" textAnchor="end">read</text>
        <text x={W - 2} y={6} fontSize="9" fill="#a3a3a3" textAnchor="end">in library</text>
      </g>
    </svg>
  );
}

export default function DataViz() {
  const [stats, setStats] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [authors, setAuthors] = useState(null);
  const [trajectory, setTrajectory] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [tagDecade, setTagDecade] = useState(null);
  const [lag, setLag] = useState(null);
  const [scatter, setScatter] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getStats(),
      api.getReadingCalendar(),
      api.getAuthors(),
      api.getLibraryTrajectory(),
      api.getSeriesCompletion(),
      api.getTagDecadeMatrix(),
      api.getReadingLag(),
      api.getPageRatingScatter(),
    ])
      .then(([s, c, a, t, sc, td, lg, ps]) => {
        setStats(s); setCalendar(c); setAuthors(a); setTrajectory(t); setCompletion(sc); setTagDecade(td); setLag(lg); setScatter(ps);
      })
      .catch(() => setError('Failed to load data.'));
  }, []);

  const acq = useMemo(
    () => buildAcquisitionPanels(stats?.acquiredByYearAndSource),
    [stats],
  );
  const cal = useMemo(() => buildCalendar(calendar), [calendar]);
  const life = useMemo(() => buildLifespans(authors), [authors]);
  const comp = useMemo(() => buildSeriesCompletion(completion), [completion]);
  const spec = useMemo(() => buildSpectrum(stats?.decadesPublished), [stats]);
  const tdm  = useMemo(() => buildTagDecade(tagDecade), [tagDecade]);
  const lagh = useMemo(() => buildReadingLag(lag), [lag]);
  const dd   = useMemo(() => buildDotDash(scatter), [scatter]);
  const mar  = useMemo(() => buildBookMarey(lag), [lag]);

  if (error) return <div role="alert" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-warn text-sm">{error}</div>;
  if (!stats || !calendar || !authors || !trajectory || !completion || !tagDecade || !lag || !scatter) return <div role="status" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 text-neutral-700 text-sm">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
      <h1 className="font-slab text-2xl text-parchment tracking-wide uppercase">Data visualization</h1>

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

      {/* ── Experiment #5 — Series completion as sparklines ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #5 — Series completion sparklines</span>. {comp.length} series with {COMPLETION_MIN_KNOWN}+ known volumes, sorted by completion percentage. Each cell is one volume — filled if owned, hollow outline if catalogued-but-not-owned, faint background if no entry. Strip width is shared across all rows so a 30-volume manga and a 3-volume trilogy occupy the same horizontal budget; the count column on the right gives the absolute scale.
        </p>
        <div className="space-y-1.5">
          {comp.map(s => <CompletionRow key={s.name} {...s} />)}
        </div>
      </section>

      {/* ── Experiment #6 — Year-published spectrum ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #6 — Year-published spectrum</span>, {fmtYear(spec.minDecade)} – {fmtYear(spec.maxDecade)}. Decade-binned histogram of every book's original publication year, layered: muted neutral for all books in the library, warm parchment for the read subset. Empty decades stay visible — the sparse BCE/medieval span is itself the data shape, not a layout problem to fix. Tallest decade: {fmtYear(spec.bins.reduce((m, b) => b.count > m.count ? b : m, { decade: 0, count: 0 }).decade)}s with {spec.yMax} books.
        </p>
        <SpectrumChart {...spec} />
      </section>

      {/* ── Experiment #7 — Tags × decade heatmap ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #7 — Tags × decade heatmap</span>, {fmtYear(tdm.minDecade)} – {fmtYear(tdm.maxDecade)}. {tdm.tags.length} subject tags with {TAG_MIN_TOTAL}+ books, sorted by total. Cell shade encodes books-with-this-tag-from-this-decade; thresholds are asymmetric (more resolution at the low end so the BCE/medieval wisps stay visible alongside the 20th-century pile). Hover any cell for the exact count.
        </p>
        <HeatLegend />
        <div className="overflow-x-auto">
          <TagDecadeMatrix {...tdm} />
        </div>
      </section>

      {/* ── Experiment #8 — Reading-lag distribution ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #8 — Reading lag distribution</span>. Days between acquiring a book and finishing it, bucketed on a log-ish scale. Companion to #4: that one is the macro view of the to-read mountain; this is the micro view of "how fast did each book actually move through the queue?" Median bin is flagged inline. Hover any bar to see up to 5 example books in that bucket.
        </p>
        <LagHistogram {...lagh} />
      </section>

      {/* ── Experiment #9 — Dot-dash plot: page count × rating ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #9 — Page count × rating, dot-dash</span>. {dd.rows.length} rated books with a known page count. Each dot is one book; the axes are replaced by marginal rug plots (every book's value contributes a tiny tick), so the same ink is doing three jobs at once — drawing the scatter, framing the chart, and showing each variable's 1D distribution. Dots are coloured by format; dashed lines mark the medians of each axis.
        </p>
        <FormatLegend />
        <DotDashPlot {...dd} />
      </section>

      {/* ── Experiment #10 — Per-book acquisition→finish Marey ── */}
      <section className="space-y-4">
        <p className="text-sm text-neutral-500">
          <span className="text-neutral-300 font-semibold">Experiment #10 — Acquisition → finish, per book</span>. {mar.rows.length} dated finishes; rows sorted by acquisition date (oldest at top). Each bar spans acquisition_date → date_finished, so its length is that book's lag and its horizontal position is when the event happened in the library's lifetime. Tufte "narrative graphics of space and time" at book scale. The five longest-lag books are labelled inline.
        </p>
        <BookMareyChart {...mar} />
      </section>
    </div>
  );
}
