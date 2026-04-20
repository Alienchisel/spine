const MISSING_FIELDS = [
  { key: 'cover',     label: 'Cover' },
  { key: 'author',    label: 'Author' },
  { key: 'format',    label: 'Format' },
  { key: 'isbn',      label: 'ISBN/ASIN' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'rating',      label: 'Rating' },
  { key: 'description', label: 'Description' },
];

const FORMAT_LABEL = { physical: 'Physical', ebook: 'E-book', audiobook: 'Audiobook' };

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

function FilterSection({ label, children }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="text-xs font-semibold text-neutral-600 uppercase tracking-wider w-20 flex-shrink-0 pt-1.5">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default function FilterPanel({ allBooks, filters, onChange }) {
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

  function toggleCustom(val) {
    onChange({ ...filters, custom: filters.custom === val ? null : val });
  }

  function toggleLoved(val) {
    onChange({ ...filters, loved: filters.loved === val ? null : val });
  }

  const formats = ['physical', 'ebook', 'audiobook'].filter(f => allBooks.some(b => b.format === f));
  const hasEmptyFormat = allBooks.some(b => !b.format);

  const publishers = [...new Set(allBooks.map(b => b.publisher).filter(Boolean))].sort();
  const hasEmptyPublisher = allBooks.some(b => !b.publisher);

  const seriesVals = [...new Set(allBooks.map(b => b.series).filter(Boolean))].sort();
  const hasEmptySeries = allBooks.some(b => !b.series);

  const tags = [...new Set(allBooks.flatMap(b => b.tags?.map(t => t.name) || []))].sort();

  const ratings = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].filter(r => allBooks.some(b => b.rating === r));
  const hasEmptyRating = allBooks.some(b => !b.rating);

  return (
    <div className="space-y-3 pt-4 pb-3 border-t border-neutral-800/60">
      <FilterSection label="Missing">
        {MISSING_FIELDS.map(f => (
          <button key={f.key} type="button"
            onClick={() => toggle('missing', f.key)}
            className={pill(filters.missing.includes(f.key), 'missing')}>
            {f.label}
          </button>
        ))}
      </FilterSection>

      {(formats.length > 0 || hasEmptyFormat) && (
        <FilterSection label="Format">
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
        <FilterSection label="Rating">
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
        <FilterSection label="Publisher">
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

      {(seriesVals.length > 0 || hasEmptySeries) && (
        <FilterSection label="Series">
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
        <FilterSection label="Tags">
          {tags.map(t => (
            <button key={t} type="button" onClick={() => toggle('tags', t)}
              className={pill(filters.tags.includes(t))}>
              {t}
            </button>
          ))}
        </FilterSection>
      )}

      <FilterSection label="Owned">
        <button type="button" onClick={() => toggleOwned(true)}
          className={pill(filters.owned === true)}>Owned</button>
        <button type="button" onClick={() => toggleOwned(false)}
          className={pill(filters.owned === false)}>Not owned</button>
      </FilterSection>

      <FilterSection label="Type">
        <button type="button" onClick={() => toggleCustom(true)}
          className={pill(filters.custom === true)}>✦ Custom</button>
        <button type="button" onClick={() => toggleCustom(false)}
          className={pill(filters.custom === false)}>Standard</button>
      </FilterSection>

      <FilterSection label="Loved">
        <button type="button" onClick={() => toggleLoved(true)}
          className={pill(filters.loved === true)}>♥ Loved</button>
        <button type="button" onClick={() => toggleLoved(false)}
          className={pill(filters.loved === false)}>Not loved</button>
      </FilterSection>
    </div>
  );
}
