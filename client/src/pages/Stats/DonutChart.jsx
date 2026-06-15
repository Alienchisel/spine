import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { FROM_STATS } from './shared.jsx';

// Small donut chart + legend rows used by the Library breakdown section.
// Each datum is { name, value, color, href? }; rows with an href become
// click-throughs to the matching Library filter, rows without stay plain.
export default function DonutChart({ title, data }) {
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
          // Tooltip carries the absolute count — the donut chart's
          // recharts tooltip shows it on slice hover, but the legend
          // rows below it only show the percent. Hovering the legend
          // now reveals the raw number that drives the percent.
          const tooltip = `${d.name} · ${d.value.toLocaleString()}`;
          return d.href ? (
            <Link key={i} to={d.href} state={FROM_STATS} className="group flex items-center justify-between text-xs" title={tooltip}>
              {inner}
            </Link>
          ) : (
            <div key={i} className="flex items-center justify-between text-xs" title={tooltip}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
