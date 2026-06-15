import { Link } from 'react-router-dom';
import { plural } from '../../../utils.js';
import { FROM_STATS, Section, Bar } from '../shared.jsx';

// Bottom two-column grid: a stack of bar-list sections that share
// shape (label / bar / caption) but vary in scope. Each section is
// gated on having data so a fresh library doesn't sprout a row of
// empty headings.
export default function BarsGrid({ ratings, topAuthors, topLovedAuthors = [], topNarrators = [], topSeries = [], authorsByGender }) {
  const maxRating       = Math.max(...ratings.map(r => r.count), 1);
  const maxAuthor       = Math.max(...topAuthors.map(a => a.count), 1);
  const maxLovedAuthor  = Math.max(...topLovedAuthors.map(a => a.count), 1);
  const maxNarrator     = Math.max(...topNarrators.map(n => n.count), 1);

  const genderRows = [
    { key: 'male',       label: 'Male' },
    { key: 'female',     label: 'Female' },
    { key: 'other',      label: 'Other' },
    { key: 'unassigned', label: 'Unassigned' },
  ].map(r => ({ ...r, count: authorsByGender[r.key] || 0 }));
  const maxGender = Math.max(...genderRows.map(r => r.count), 1);
  const hasGender = genderRows.some(r => r.count > 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
      <Section title="Ratings">
        <div className="space-y-2.5">
          {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map(r => {
            const entry = ratings.find(x => x.rating === r);
            if (!entry) return null;
            const full = Math.floor(r);
            const half = r % 1 !== 0;
            return (
              <Bar
                key={r}
                label={'★'.repeat(full) + (half ? '½' : '')}
                count={entry.count}
                max={maxRating}
                color="bg-oak"
                href={`/browse/rating/${r}`}
                caption={plural(entry.count, 'book')}
              />
            );
          })}
          {ratings.length === 0 && <p className="text-xs text-neutral-600">No ratings yet</p>}
        </div>
      </Section>

      {topAuthors.length > 0 && (
        <Section
          title="Top authors"
          action={
            <Link to="/collage?mode=top_authors" state={FROM_STATS} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">
              View as collage →
            </Link>
          }
        >
          <div className="space-y-2.5">
            {topAuthors.map(a => (
              <Bar
                key={a.author_id ?? a.author}
                label={a.aliases_count > 0 ? `${a.author} +${a.aliases_count}` : a.author}
                count={a.count}
                max={maxAuthor}
                color="bg-binding"
                href={a.author_id ? `/authors/${a.author_id}` : `/browse/author/${encodeURIComponent(a.author)}`}
                caption={plural(a.count, 'book')}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Most-loved authors: a derived "favorite authors" surface that
          piggybacks on per-book loved flags rather than an explicit
          author-level favorite, ranking by count of loved books per
          author (alias-collapsed). Skipped entirely when nothing is
          loved-flagged. */}
      {topLovedAuthors.length > 0 && (
        <Section title="Most-loved authors">
          <div className="space-y-2.5">
            {topLovedAuthors.map(a => (
              <Bar
                key={a.author_id ?? a.author}
                label={a.aliases_count > 0 ? `${a.author} +${a.aliases_count}` : a.author}
                count={a.count}
                max={maxLovedAuthor}
                color="bg-rose-500/70"
                href={a.author_id ? `/authors/${a.author_id}` : `/browse/author/${encodeURIComponent(a.author)}`}
                caption={`${a.count} loved`}
              />
            ))}
          </div>
        </Section>
      )}

      {topNarrators.length > 0 && (
        <Section title="Top narrators">
          <div className="space-y-2.5">
            {topNarrators.map(n => (
              <Bar key={n.narrator} label={n.narrator} count={n.count} max={maxNarrator} color="bg-oak" href={`/browse/narrator/${encodeURIComponent(n.narrator)}`} caption={plural(n.count, 'book')} />
            ))}
          </div>
        </Section>
      )}

      {topSeries.length > 0 && (
        <Section
          title="Top series"
          action={
            <Link to="/series" state={FROM_STATS} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">
              All series →
            </Link>
          }
        >
          <div className="space-y-2.5">
            {topSeries.map(s => (
              <Bar key={s.series} label={s.series} count={s.count} max={topSeries[0].count} color="bg-leather" href={`/browse/series/${encodeURIComponent(s.series)}`} caption={plural(s.count, 'book')} />
            ))}
          </div>
        </Section>
      )}

      {hasGender && (
        <Section title="Authors by gender">
          <div className="space-y-2.5">
            {genderRows.map(r => (
              <Bar
                key={r.key}
                label={r.label}
                count={r.count}
                max={maxGender}
                color={r.key === 'unassigned' ? 'bg-neutral-700' : 'bg-binding'}
                href={`/browse/author_gender/${r.key}`}
                caption={plural(r.count, 'author')}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
