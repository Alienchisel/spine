import { plural } from '../../../utils.js';
import { Section, Bar } from '../shared.jsx';

// Calendar-year bar list of finished-reads. Caption stacks book count
// with total pages so a quiet but heavy year (one 1200-page brick)
// reads differently from a busy short-read year.
export default function FinishedByYear({ byYear = [] }) {
  if (byYear.length === 0) return null;
  const max = Math.max(...byYear.map(y => y.count), 1);
  return (
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
              max={max}
              color="bg-leather"
              href={`/browse/year_finished/${y.year}`}
              caption={parts.join(' · ')}
            />
          );
        })}
      </div>
    </Section>
  );
}
