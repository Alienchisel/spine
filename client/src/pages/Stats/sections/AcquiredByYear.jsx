import { plural } from '../../../utils.js';
import { Section, Bar } from '../shared.jsx';

// Counterpart to Finished by year — when did the books in the library
// arrive? Useful for tracking acquisition pace independent of reading
// pace; the gap between the two is the "to-read mountain" Audit slice.
export default function AcquiredByYear({ acquiredByYear = [] }) {
  if (acquiredByYear.length === 0) return null;
  const max = Math.max(...acquiredByYear.map(y => y.count), 1);
  return (
    <Section title="Acquired by year">
      <div className="space-y-2.5">
        {acquiredByYear.map(y => (
          <Bar
            key={y.year}
            label={y.year}
            count={y.count}
            max={max}
            color="bg-oak"
            href={`/browse/year_acquired/${y.year}`}
            caption={plural(y.count, 'book')}
          />
        ))}
      </div>
    </Section>
  );
}
