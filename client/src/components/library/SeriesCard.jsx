import { formatAuthors } from '../../utils.js';
import { sortVolumes } from './grouping.js';

export default function SeriesCard({ seriesName, books, expanded, onToggle, compact }) {
  const sorted = sortVolumes(books);
  const statusCounts = books.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});
  const statusParts = [
    statusCounts.reading  && `${statusCounts.reading} reading`,
    statusCounts.paused   && `${statusCounts.paused} paused`,
    statusCounts.finished && `${statusCounts.finished} finished`,
    statusCounts.unread   && `${statusCounts.unread} unread`,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group transition-[background-color] ease-out duration-150 text-left w-full ${compact ? 'hover:opacity-80' : `bg-card rounded-lg p-2 pb-2.5 ${expanded ? 'ring-1 ring-binding/40' : ''}`}`}
    >
      {/* Hover signal: same warm oak rim as BookCard. The previous lift on
          the wrapper read as a card-pop; a static frame with a coloured ring
          is quieter and matches the calm-bookish aesthetic. */}
      <div className={`relative aspect-[2/3] overflow-hidden ring-2 ring-white/5 group-hover:ring-oak/60 transition-[box-shadow] duration-150 ${compact ? 'rounded-sm' : 'mb-2.5 rounded shadow-[0_10px_20px_-5px_rgba(0,0,0,0.55),0_4px_8px_-2px_rgba(0,0,0,0.35)]'}`}>
        {sorted.slice(0, 4).map((vol, i, arr) => {
          const n = arr.length;
          const leftPct = n === 1 ? 0 : (i * 45 / (n - 1));
          const width = n === 1 ? '100%' : '55%';
          return (
            <div key={vol.id} className="absolute top-0 bottom-0 overflow-hidden" style={{ left: `${leftPct}%`, width }}>
              {vol.cover_path ? (
                <img src={vol.cover_path} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-neutral-700 to-neutral-900 flex items-end p-2">
                  {i === n - 1 && <span className="text-xs text-neutral-400 font-medium leading-tight line-clamp-4">{seriesName}</span>}
                </div>
              )}
              {i > 0 && (
                <>
                  {/* Depth shadow cast by the cover in front of this one. */}
                  <div className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/50 to-transparent pointer-events-none" />
                  {/* Hairline spine sliver — leather-toned warmth at the very
                      leftmost edge, suggesting the binding of the book behind
                      is just barely visible. */}
                  <div className="absolute inset-y-0 left-0 w-px bg-binding/80 pointer-events-none" />
                </>
              )}
            </div>
          );
        })}
        <div className="absolute top-1.5 right-1.5 bg-black/75 text-neutral-300 text-xs font-bold px-1.5 py-0.5 rounded backdrop-blur-sm leading-none">
          {books.length}
        </div>
      </div>
      {!compact && <>
        <p className="text-sm font-medium text-neutral-200 truncate leading-tight" title={seriesName}>{seriesName}</p>
        {sorted[0]?.authors?.length > 0 && <p className="text-xs text-neutral-500 truncate mt-0.5">{formatAuthors(sorted[0].authors)}</p>}
        {statusParts.length > 0 && <p className="text-xs text-neutral-600 truncate mt-0.5">{statusParts.join(' · ')}</p>}
      </>}
    </button>
  );
}
