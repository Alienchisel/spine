import { useState } from 'react';
import { VIRTUAL_TAG_NAMES } from '../../../shared/bookFields.js';
import { FORMAT_LABEL } from '../utils.js';

// Ordered by semantic cluster (identity → bibliographic → size →
// descriptive → ownership). When adding a new pill, slot it into the
// matching cluster rather than appending at the end.
const MISSING_FIELDS = [
  // Identity & people
  { key: 'cover',       label: 'Cover' },
  { key: 'author',      label: 'Author' },
  { key: 'narrator',    label: 'Narrator' },
  { key: 'translator',  label: 'Translator' },
  // Bibliographic
  { key: 'format',      label: 'Format' },
  { key: 'binding',     label: 'Binding' },
  { key: 'position',    label: 'Shelf position' },
  { key: 'isbn',        label: 'ISBN/ASIN' },
  { key: 'publisher',   label: 'Publisher' },
  { key: 'year',        label: 'Year' },
  // Size
  { key: 'pages',       label: 'Pages' },
  { key: 'page_count',  label: 'Page count' },
  { key: 'duration',    label: 'Duration' },
  // Descriptive
  { key: 'language',    label: 'Language' },
  { key: 'fiction',     label: 'Fiction/NF' },
  { key: 'description', label: 'Description' },
  { key: 'rating',      label: 'Rating' },
  { key: 'stories',     label: 'Contents' },
  // Ownership — both gated to owned, non-custom books on the server
  // (acquisition data only makes sense for things you actually bought).
  { key: 'source',      label: 'Source',   title: 'Owned, non-custom books missing acquisition source. For all books with no source (incl. unowned), use Source → Missing source.' },
  { key: 'acquired',    label: 'Acquired', title: 'Owned, non-custom books missing acquisition date.' },
];


function pill(active, variant = 'default') {
  const base = 'text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 motion-safe:active:scale-[0.98]';
  if (variant === 'missing') {
    return `${base} ${active
      ? 'bg-warn/20 text-warn border-warn/50'
      : 'border-neutral-700 text-neutral-500 hover:border-warn/40 hover:text-neutral-300'}`;
  }
  return `${base} ${active
    ? 'bg-binding/50 text-parchment border-binding/70'
    : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}`;
}

function FilterSection({ label, children, defaultOpen = true, active = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const showDot = active && !open;
  return (
    <div className="flex gap-3 items-start">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${label}${active ? ' (filters active)' : ''}`}
        className="w-20 flex-shrink-0 pt-1.5 flex items-center gap-1 group text-left"
      >
        <span className={`text-xs font-semibold uppercase tracking-wider transition-colors ${
          showDot ? 'text-oak group-hover:text-oak/80' : 'text-neutral-600 group-hover:text-neutral-500'
        }`}>
          {label}
        </span>
        {showDot && <span className="w-1.5 h-1.5 rounded-full bg-oak flex-shrink-0 mt-px" />}
        <span className={`text-neutral-700 text-[9px] leading-none transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>
      {open && <div className="flex flex-wrap gap-1.5">{children}</div>}
    </div>
  );
}

// Status filter is hidden on the four single-status tabs since picking one
// of those tabs already constrains the result set to that status — adding
// status chips on top would either be redundant ("Reading" tab + Reading
// chip) or contradictory ("Reading" tab + Finished chip → empty result
// because the conditions AND together). On owned / prev_owned / loved /
// all, status is orthogonal and the chips are useful.
const STATUS_TABS_HIDING_STATUS_FILTER = new Set(['reading', 'finished', 'unread']);

const STATUSES = [
  { key: 'reading',  label: 'Reading' },
  { key: 'finished', label: 'Finished' },
  { key: 'unread',   label: 'Unread' },
];

export default function FilterPanel({ tab, facets, filters, onChange }) {
  if (!facets) return null;
  function toggle(section, value) {
    const cur = filters[section];
    onChange({
      ...filters,
      [section]: cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value],
    });
  }

  function toggleOwned(val) {
    onChange({ ...filters, owned: filters.owned === val ? null : val });
  }

  function togglePreviouslyOwned(val) {
    onChange({ ...filters, previouslyOwned: filters.previouslyOwned === val ? null : val });
  }

  function toggleCustom(val) {
    onChange({ ...filters, custom: filters.custom === val ? null : val });
  }

  function toggleLoved(val) {
    onChange({ ...filters, loved: filters.loved === val ? null : val });
  }

  const formats        = facets.formats;
  const hasEmptyFormat = facets.hasEmptyFormat;
  const publishers     = facets.publishers;
  const hasEmptyPublisher = facets.hasEmptyPublisher;
  const seriesVals     = facets.series;
  const hasEmptySeries = facets.hasEmptySeries;
  const tags           = facets.tags;
  const ratings        = facets.ratings;
  const hasEmptyRating = facets.hasEmptyRating;

  return (
    <div className="space-y-3 pt-4 pb-3 border-t border-neutral-800/60">
      {(formats.length > 0 || hasEmptyFormat) && (
        <FilterSection key="format" label="Format" active={filters.formats.length > 0}>
          {hasEmptyFormat && (
            <button type="button" onClick={() => toggle('formats', 'empty')}
              aria-pressed={filters.formats.includes('empty')}
              aria-label="Missing format"
              className={pill(filters.formats.includes('empty'))}>—</button>
          )}
          {formats.map(f => (
            <button key={f} type="button" onClick={() => toggle('formats', f)}
              aria-pressed={filters.formats.includes(f)}
              className={pill(filters.formats.includes(f))}>
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </FilterSection>
      )}

      {!STATUS_TABS_HIDING_STATUS_FILTER.has(tab) && (
        <FilterSection key="status" label="Status" active={(filters.statuses?.length || 0) > 0}>
          {STATUSES.map(s => (
            <button key={s.key} type="button" onClick={() => toggle('statuses', s.key)}
              aria-pressed={(filters.statuses || []).includes(s.key)}
              className={pill(filters.statuses?.includes(s.key))}>
              {s.label}
            </button>
          ))}
        </FilterSection>
      )}

      {(ratings.length > 0 || hasEmptyRating) && (
        <FilterSection key="rating" label="Rating" active={filters.ratings.length > 0}>
          {hasEmptyRating && (
            <button type="button" onClick={() => toggle('ratings', 'empty')}
              aria-pressed={filters.ratings.includes('empty')}
              aria-label="Unrated"
              className={pill(filters.ratings.includes('empty'))}>—</button>
          )}
          {ratings.map(r => (
            <button key={r} type="button" onClick={() => toggle('ratings', r)}
              aria-pressed={filters.ratings.includes(r)}
              aria-label={`Filter by ${r} star${r === 1 ? '' : 's'}`}
              className={pill(filters.ratings.includes(r))}>
              {'★'.repeat(Math.floor(r))}{r % 1 !== 0 ? '½' : ''}
            </button>
          ))}
        </FilterSection>
      )}

      <FilterSection key="owned" label="Owned" active={filters.owned !== null || filters.previouslyOwned !== null}>
        <button type="button" onClick={() => toggleOwned(true)}
          aria-pressed={filters.owned === true}
          className={pill(filters.owned === true)}>Owned</button>
        <button type="button" onClick={() => toggleOwned(false)}
          aria-pressed={filters.owned === false}
          className={pill(filters.owned === false)}>Not owned</button>
        <button type="button" onClick={() => togglePreviouslyOwned(true)}
          aria-pressed={filters.previouslyOwned === true}
          className={pill(filters.previouslyOwned === true)}>Previously owned</button>
      </FilterSection>

      <FilterSection key="type" label="Type" active={filters.custom !== null}>
        <button type="button" onClick={() => toggleCustom(true)}
          aria-pressed={filters.custom === true}
          className={pill(filters.custom === true)}>✦ Custom</button>
        <button type="button" onClick={() => toggleCustom(false)}
          aria-pressed={filters.custom === false}
          className={pill(filters.custom === false)}>Standard</button>
      </FilterSection>

      <FilterSection key="loved" label="Loved" active={filters.loved !== null}>
        <button type="button" onClick={() => toggleLoved(true)}
          aria-pressed={filters.loved === true}
          className={pill(filters.loved === true)}>♥ Loved</button>
        <button type="button" onClick={() => toggleLoved(false)}
          aria-pressed={filters.loved === false}
          className={pill(filters.loved === false)}>Not loved</button>
      </FilterSection>

      {/* Long-list filters live at the bottom so their length when opened
          doesn't shove the compact toggle filters off-screen. Tags is
          open by default (heavily used); Publisher / Source / Series
          stay collapsed. */}
      {tags.length > 0 && (
        <FilterSection key="tags" label="Tags" active={filters.tags.length > 0}>
          {(() => {
            // The All/Any toggle only matters when 2+ real (non-virtual) tags
            // are selected. Virtual tags are always ANDed individually, so
            // they don't participate in the mode.
            const selectedRealCount = filters.tags.filter(t => !VIRTUAL_TAG_NAMES.includes(t)).length;
            if (selectedRealCount < 2) return null;
            return (
              <div className="w-full flex items-center gap-1.5 mb-2 text-xs">
                <span className="text-neutral-500">match</span>
                <div role="radiogroup" aria-label="Tag match mode" className="flex items-center gap-1.5">
                  {['all', 'any'].map(mode => (
                    <button key={mode} type="button" role="radio"
                      aria-checked={(filters.tagsMode || 'all') === mode}
                      onClick={() => onChange({ ...filters, tagsMode: mode })}
                      className={`px-2 py-0.5 rounded-full transition-colors ${
                        (filters.tagsMode || 'all') === mode
                          ? 'bg-binding/30 text-parchment'
                          : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
                      }`}>
                      {mode}
                    </button>
                  ))}
                </div>
                <span className="text-neutral-600 ml-1">
                  {(filters.tagsMode || 'all') === 'all' ? '— books with every selected tag' : '— books with any selected tag'}
                </span>
              </div>
            );
          })()}
          {tags.map(t => (
            <button key={t} type="button" onClick={() => toggle('tags', t)}
              aria-pressed={filters.tags.includes(t)}
              className={pill(filters.tags.includes(t))}>
              {t}
            </button>
          ))}
        </FilterSection>
      )}

      {(publishers.length > 0 || hasEmptyPublisher) && (
        <FilterSection key="publisher" label="Publisher" defaultOpen={false} active={filters.publishers.length > 0}>
          {hasEmptyPublisher && (
            <button type="button" onClick={() => toggle('publishers', 'empty')}
              aria-pressed={filters.publishers.includes('empty')}
              aria-label="Missing publisher"
              className={pill(filters.publishers.includes('empty'))}>—</button>
          )}
          {publishers.map(p => (
            <button key={p} type="button" onClick={() => toggle('publishers', p)}
              aria-pressed={filters.publishers.includes(p)}
              className={pill(filters.publishers.includes(p))}>
              {p}
            </button>
          ))}
        </FilterSection>
      )}

      {(facets.sources?.length > 0 || facets.hasEmptySource) && (
        <FilterSection key="source" label="Source" defaultOpen={false} active={(filters.sources || []).length > 0}>
          {facets.hasEmptySource && (
            <button type="button" onClick={() => toggle('sources', 'empty')}
              aria-pressed={(filters.sources || []).includes('empty')}
              aria-label="Missing source"
              className={pill((filters.sources || []).includes('empty'))}>—</button>
          )}
          {facets.sources.map(s => (
            <button key={s} type="button" onClick={() => toggle('sources', s)}
              aria-pressed={(filters.sources || []).includes(s)}
              className={pill((filters.sources || []).includes(s))}>
              {s}
            </button>
          ))}
        </FilterSection>
      )}

      {(seriesVals.length > 0 || hasEmptySeries) && (
        <FilterSection key="series" label="Series" defaultOpen={false} active={filters.series.length > 0}>
          {hasEmptySeries && (
            <button type="button" onClick={() => toggle('series', 'empty')}
              aria-pressed={filters.series.includes('empty')}
              aria-label="Missing series"
              className={pill(filters.series.includes('empty'))}>—</button>
          )}
          {seriesVals.map(s => (
            <button key={s} type="button" onClick={() => toggle('series', s)}
              aria-pressed={filters.series.includes(s)}
              className={pill(filters.series.includes(s))}>
              {s}
            </button>
          ))}
        </FilterSection>
      )}

      {/* Missing-fields filter is curation/admin-style, not everyday
          browsing — collapsed and tucked at the very bottom. */}
      <FilterSection key="missing" label="Missing" defaultOpen={false} active={filters.missing.length > 0}>
        {MISSING_FIELDS.map(f => (
          <button key={f.key} type="button"
            onClick={() => toggle('missing', f.key)}
            aria-pressed={filters.missing.includes(f.key)}
            title={f.title}
            className={pill(filters.missing.includes(f.key), 'missing')}>
            {f.label}
          </button>
        ))}
      </FilterSection>
    </div>
  );
}
