import { Link } from 'react-router-dom';
import { FROM_STATS } from '../shared.jsx';

// Top-of-page dashboard row: five big numbers — Books, Authors, Pages
// read, Hours listened, Day streak. Each links to the matching filtered
// surface so a glance + a click takes the user from "I have N books" to
// the list itself.
export default function Hero({ totals, authorsByGender, pagesRead, minutesListened, streaks }) {
  // Total authors derived from the gender breakdown — sum of all four
  // buckets equals the distinct author count, so we don't need a
  // separate stats query for it.
  const authorTotal = (authorsByGender.male || 0) + (authorsByGender.female || 0)
                    + (authorsByGender.other || 0) + (authorsByGender.unassigned || 0);
  const cards = [
    { label: 'Books in library', value: totals?.owned?.toLocaleString() ?? '—', to: '/?tab=owned' },
    { label: 'Authors',          value: authorTotal > 0 ? authorTotal.toLocaleString() : '—', to: '/authors' },
    { label: 'Pages read',       value: pagesRead?.toLocaleString() ?? '—', to: '/?tab=all&formats=physical&formats=ebook&progress=any' },
    { label: 'Hours listened',   value: minutesListened > 0 ? Math.floor(minutesListened / 60).toLocaleString() : '—', to: '/?tab=all&formats=audiobook&progress=any' },
    { label: 'Day streak',       value: streaks?.days?.current?.toLocaleString() ?? '0', to: '/diary' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-6 sm:gap-8 py-4">
      {cards.map(h => {
        const inner = (
          <>
            <p className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wider mb-1">{h.label}</p>
            <p className="font-slab text-4xl sm:text-5xl text-parchment tabular-nums leading-none">{h.value}</p>
          </>
        );
        return h.to ? (
          <Link key={h.label} to={h.to} state={FROM_STATS} className="block text-center sm:text-left hover:opacity-80 transition-opacity">
            {inner}
          </Link>
        ) : (
          <div key={h.label} className="text-center sm:text-left">{inner}</div>
        );
      })}
    </div>
  );
}
