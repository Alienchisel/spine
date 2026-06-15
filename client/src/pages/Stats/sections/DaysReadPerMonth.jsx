import { plural } from '../../../utils.js';
import { Section, Bar } from '../shared.jsx';

// Calendar-month bar list: one row per month with logged reading.
// Server returns oldest → newest, label is rendered "Mar 2026"-style.
export default function DaysReadPerMonth({ byMonth = [] }) {
  if (byMonth.length === 0) return null;
  const max = Math.max(...byMonth.map(m => m.days), 1);
  return (
    <Section title="Days read per month">
      <div className="space-y-2.5">
        {byMonth.map(m => {
          const [y, mo] = m.month.split('-').map(Number);
          const label = new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          return (
            <Bar
              key={m.month}
              label={label}
              count={m.days}
              max={max}
              color="bg-oak"
              caption={plural(m.days, 'day')}
            />
          );
        })}
      </div>
    </Section>
  );
}
