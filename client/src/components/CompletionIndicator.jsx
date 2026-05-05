// Letterboxd-style completion indicator: small label + "X of Y" on the left,
// big percentage on the right, progress bar across the bottom. Used on the
// Lists overview row badges and the ListDetail header.
//
// `size` — 'lg' for the detail-header form, 'sm' for the inline overview row.
// Falls back to a quiet em-dash placeholder when there are no items, so an
// empty list doesn't produce a 0/0 division-by-zero or a misleading 0%.
export default function CompletionIndicator({ label, count, total, size = 'lg' }) {
  const empty = total === 0;
  const pct = empty ? 0 : Math.round((count / total) * 100);
  const isLg = size === 'lg';

  return (
    <div className={`bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden ${isLg ? 'px-4 py-3' : 'px-3 py-2'}`}>
      <div className={`flex items-center justify-between ${isLg ? 'gap-4' : 'gap-3'}`}>
        <div className="min-w-0">
          <p className={`text-neutral-400 leading-tight ${isLg ? 'text-sm' : 'text-xs'}`}>{label}</p>
          {empty ? (
            <p className={`text-neutral-600 leading-tight tabular-nums ${isLg ? 'text-sm' : 'text-xs'}`}>—</p>
          ) : (
            <p className={`text-neutral-300 leading-tight tabular-nums ${isLg ? 'text-sm' : 'text-xs'}`}>
              {count} of {total}
            </p>
          )}
        </div>
        <p className={`font-light text-neutral-200 tabular-nums leading-none flex-shrink-0 ${isLg ? 'text-3xl' : 'text-xl'}`}>
          {empty ? '—' : <>{pct}<span className={`text-neutral-500 ${isLg ? 'text-base' : 'text-xs'} ml-0.5`}>%</span></>}
        </p>
      </div>
      <div className={`bg-neutral-800 rounded-full overflow-hidden ${isLg ? 'h-1.5 mt-3' : 'h-1 mt-1.5'}`}>
        <div className="h-full bg-oak transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
