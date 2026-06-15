import { Link } from 'react-router-dom';
import { FORMAT_LABEL } from '../../../utils.js';
import { FROM_STATS, Section } from '../shared.jsx';
import DonutChart from '../DonutChart.jsx';
import TagTreemap from '../TagTreemap.jsx';

// Four donuts on the left (Fiction / Format / Status / Source) and the
// tag treemap on the right. The two sub-views complement each other:
// donuts cover the structural taxonomies, the treemap covers the
// long-tail tag composition. Stacks on mobile so neither gets squeezed.
export default function LibraryBreakdown({ fiction, formats, ownedStatus, acquisitionSources, topTags }) {
  return (
    <Section
      title="Library breakdown"
      action={topTags?.length > 0 ? (
        <Link to="/tags" state={FROM_STATS} className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors">
          All tags →
        </Link>
      ) : null}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
          <DonutChart
            title="Fiction / Non-fiction"
            // Fiction isn't a URL-state filter on Library — the existing
            // /browse/fiction/:value page handles it, same target the
            // Fiction bar list further down uses.
            data={[
              { name: 'Fiction',     value: fiction.fiction    ?? 0, color: '#a97954', href: '/browse/fiction/fiction' },
              { name: 'Non-fiction', value: fiction.nonfiction ?? 0, color: '#c29b87', href: '/browse/fiction/nonfiction' },
              { name: 'Unknown',     value: fiction.unset      ?? 0, color: '#404040', href: '/browse/fiction/unset' },
            ].filter(d => d.value > 0)}
          />
          <DonutChart
            title="Format"
            data={formats.map((f, i) => ({
              name:  FORMAT_LABEL[f.format] || (f.format ? f.format.charAt(0).toUpperCase() + f.format.slice(1) : 'Unknown'),
              value: f.count,
              color: ['#a97954', '#c29b87', '#532c2e', '#404040'][i % 4],
              href:  f.format ? `/?tab=all&formats=${f.format}` : '/?tab=all&missing=format',
            }))}
          />
          <DonutChart
            // Slices are over owned-purchased media (custom + Internet
            // excluded) — same scope as every other donut in this section,
            // captured once at the section title. The Library "Reading"
            // tile above is corpus-wide and counts a different population.
            title="Reading status"
            data={[
              { name: 'Finished', value: ownedStatus?.finished ?? 0, color: '#a97954', href: '/?tab=finished' },
              { name: 'Reading',  value: ownedStatus?.reading  ?? 0, color: '#c29b87', href: '/?tab=reading' },
              { name: 'Unread',   value: ownedStatus?.unread   ?? 0, color: '#404040', href: '/?tab=unread' },
            ].filter(d => d.value > 0)}
          />
          {acquisitionSources && (
            // Where does my library come from? Includes Internet-sourced
            // even though the Owned tab/count excludes them — this chart's
            // explicit purpose is the purchased-vs-downloaded distinction.
            // "Other" has no single acquisition_source value (it's the
            // bucket for anything not in the named columns), so no link.
            <DonutChart
              title="Source"
              data={[
                { name: 'Kindle',   value: acquisitionSources.kindle   ?? 0, color: '#a97954', href: '/?tab=all&sources=Kindle' },
                { name: 'Audible',  value: acquisitionSources.audible  ?? 0, color: '#c29b87', href: '/?tab=all&sources=Audible' },
                { name: 'Amazon',   value: acquisitionSources.amazon   ?? 0, color: '#532c2e', href: '/?tab=all&sources=Amazon' },
                { name: 'Other',    value: acquisitionSources.other    ?? 0, color: '#6a5d4f', href: '/?tab=all&sources=other' },
                { name: 'Internet', value: acquisitionSources.internet ?? 0, color: '#5a7a8a', href: '/?tab=all&sources=Internet' },
                { name: 'Unknown',  value: acquisitionSources.unknown  ?? 0, color: '#404040', href: '/?tab=all&missing=source' },
              ].filter(d => d.value > 0)}
            />
          )}
        </div>
        {topTags?.length > 0 && (
          // Treemap renders solo so its height aligns with the donut
          // grid on the left — the "All tags →" affordance lives in
          // the Section header (action prop above) where it doesn't
          // disturb the row geometry.
          <TagTreemap tags={topTags} />
        )}
      </div>
    </Section>
  );
}
