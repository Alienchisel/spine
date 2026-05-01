import { useState } from 'react';

const MISSING_FIELDS = [
  { key: 'cover',     label: 'Cover' },
  { key: 'author',    label: 'Author' },
  { key: 'narrator',  label: 'Narrator' },
  { key: 'translator', label: 'Translator' },
  { key: 'format',    label: 'Format' },
  { key: 'isbn',      label: 'ISBN/ASIN' },
  { key: 'publisher',  label: 'Publisher' },
  { key: 'year',       label: 'Year' },
  { key: 'pages',      label: 'Pages' },
  { key: 'language',   label: 'Language' },
  { key: 'fiction',     label: 'Fiction/NF' },
  { key: 'description', label: 'Description' },
  { key: 'rating',      label: 'Rating' },
  { key: 'source',      label: 'Source' },
  { key: 'acquired',    label: 'Acquired' },
];

const FORMAT_LABEL = { physical: 'Physical', ebook: 'Digital', audiobook: 'Audiobook' };

function pill(active, variant = 'default') {
  const base = 'text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-[transform,background-color,color,border-color] ease-out duration-150 active:scale-[0.98]';
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

export default function FilterPanel({ facets, filters, onChange }) {
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
      <FilterSection key="missing" label="Missing" active={filters.missing.length > 0}>
        {MISSING_FIELDS.map(f => (
          <button key={f.key} type="button"
            onClick={() => toggle('missing', f.key)}
            className={pill(filters.missing.includes(f.key), 'missing')}>
            {f.label}
          </button>
        ))}
      </FilterSection>

      {(formats.length > 0 || hasEmptyFormat) && (
        <FilterSection key="format" label="Format" active={filters.formats.length > 0}>
          {hasEmptyFormat && (
            <button type="button" onClick={() => toggle('formats', 'empty')}
              className={pill(filters.formats.includes('empty'))}>—</button>
          )}
          {formats.map(f => (
            <button key={f} type="button" onClick={() => toggle('formats', f)}
              className={pill(filters.formats.includes(f))}>
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </FilterSection>
      )}

      {(ratings.length > 0 || hasEmptyRating) && (
        <FilterSection key="rating" label="Rating" active={filters.ratings.length > 0}>
          {hasEmptyRating && (
            <button type="button" onClick={() => toggle('ratings', 'empty')}
              className={pill(filters.ratings.includes('empty'))}>—</button>
          )}
          {ratings.map(r => (
            <button key={r} type="button" onClick={() => toggle('ratings', r)}
              className={pill(filters.ratings.includes(r))}>
              {'★'.repeat(Math.floor(r))}{r % 1 !== 0 ? '½' : ''}
            </button>
          ))}
        </FilterSection>
      )}

      {(publishers.length > 0 || hasEmptyPublisher) && (
        <FilterSection key="publisher" label="Publisher" defaultOpen={false} active={filters.publishers.length > 0}>
          {hasEmptyPublisher && (
            <button type="button" onClick={() => toggle('publishers', 'empty')}
              className={pill(filters.publishers.includes('empty'))}>—</button>
          )}
          {publishers.map(p => (
            <button key={p} type="button" onClick={() => toggle('publishers', p)}
              className={pill(filters.publishers.includes(p))}>
              {p}
            </button>
          ))}
        </FilterSection>
      )}

      {(facets.sources?.length > 0) && (
        <FilterSection key="source" label="Source" defaultOpen={false} active={(filters.sources || []).length > 0}>
          {facets.sources.map(s => (
            <button key={s} type="button" onClick={() => toggle('sources', s)}
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
              className={pill(filters.series.includes('empty'))}>—</button>
          )}
          {seriesVals.map(s => (
            <button key={s} type="button" onClick={() => toggle('series', s)}
              className={pill(filters.series.includes(s))}>
              {s}
            </button>
          ))}
        </FilterSection>
      )}

      {tags.length > 0 && (
        <FilterSection key="tags" label="Tags" active={filters.tags.length > 0}>
          {tags.map(t => (
            <button key={t} type="button" onClick={() => toggle('tags', t)}
              className={pill(filters.tags.includes(t))}>
              {t}
            </button>
          ))}
        </FilterSection>
      )}

      <FilterSection key="owned" label="Owned" defaultOpen={false} active={filters.owned !== null || filters.previouslyOwned !== null}>
        <button type="button" onClick={() => toggleOwned(true)}
          className={pill(filters.owned === true)}>Owned</button>
        <button type="button" onClick={() => toggleOwned(false)}
          className={pill(filters.owned === false)}>Not owned</button>
        <button type="button" onClick={() => togglePreviouslyOwned(true)}
          className={pill(filters.previouslyOwned === true)}>Previously owned</button>
      </FilterSection>

      <FilterSection key="type" label="Type" defaultOpen={false} active={filters.custom !== null}>
        <button type="button" onClick={() => toggleCustom(true)}
          className={pill(filters.custom === true)}>✦ Custom</button>
        <button type="button" onClick={() => toggleCustom(false)}
          className={pill(filters.custom === false)}>Standard</button>
      </FilterSection>

      <FilterSection key="loved" label="Loved" defaultOpen={false} active={filters.loved !== null}>
        <button type="button" onClick={() => toggleLoved(true)}
          className={pill(filters.loved === true)}>♥ Loved</button>
        <button type="button" onClick={() => toggleLoved(false)}
          className={pill(filters.loved === false)}>Not loved</button>
      </FilterSection>
    </div>
  );
}
