import { plural } from '../../../utils.js';
import { Section, Bar } from '../shared.jsx';

// Distinct-language bar list. Gated on >1 language so a monolingual
// library doesn't sprout a one-row "Languages" section.
export default function Languages({ languages = [] }) {
  if (languages.length <= 1) return null;
  const max = Math.max(...languages.map(l => l.count));
  return (
    <Section title="Languages">
      <div className="space-y-2.5">
        {languages.map(l => (
          <Bar
            key={l.language}
            label={l.language}
            count={l.count}
            max={max}
            color="bg-binding"
            href={`/browse/language/${encodeURIComponent(l.language)}`}
            caption={plural(l.count, 'book')}
          />
        ))}
      </div>
    </Section>
  );
}
