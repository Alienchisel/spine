import { plural } from '../../../utils.js';
import { Section } from '../shared.jsx';

// 0 belongs on the CE side ("0s" = years 0–9 CE), not BCE — only
// strictly negative bucket ids are pre-Common-Era.
function decadeLabel(d) {
  return d >= 0 ? `${d}s` : `${-d - 9}–${-d} BCE`;
}

// Sparkline-style histogram of first-published decades for the whole
// library. Zero-count decades between min and max are filled in as empty
// columns so gaps in the timeline read visually instead of compressing
// away — a 1500s → 1800s gap should look like a gap, not a flat slope.
export default function DecadesPublished({ decadesPublished = [] }) {
  if (decadesPublished.length === 0) return null;
  const sorted = [...decadesPublished].sort((a, b) => a.decade - b.decade);
  const minDecade = sorted[0].decade;
  const maxDecade = sorted[sorted.length - 1].decade;
  const counts = new Map(sorted.map(d => [d.decade, d.count]));
  const buckets = [];
  for (let d = minDecade; d <= maxDecade; d += 10) {
    buckets.push({ decade: d, count: counts.get(d) ?? 0 });
  }
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
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
}
