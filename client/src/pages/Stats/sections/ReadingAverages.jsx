import { Section, StatCard } from '../shared.jsx';

// Two summary tiles: avg pages per reading day, avg calendar days to
// finish a book. Hidden when neither is computable (fresh library,
// no finished books yet).
export default function ReadingAverages({ avgPagesPerDay, avgDaysToFinish }) {
  if (avgPagesPerDay == null && avgDaysToFinish == null) return null;
  return (
    <Section title="Reading averages">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {avgPagesPerDay  != null && <StatCard label="Avg pages / reading day" value={avgPagesPerDay?.toLocaleString()} />}
        {avgDaysToFinish != null && <StatCard label="Avg days to finish"      value={avgDaysToFinish?.toLocaleString()} />}
      </div>
    </Section>
  );
}
