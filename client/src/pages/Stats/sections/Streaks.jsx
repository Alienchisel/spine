import { fmtShortDate, fmtShortMonth, fmtIsoWeekMonday } from '../../../utils.js';
import { Section } from '../shared.jsx';

// Single streak tile — current count on the left, longest on the right,
// each captioned with its start (or start–end for the longest).
function StreakTile({ title, current, currentStart, longest, longestStart, longestEnd, formatStart }) {
  return (
    <div className="bg-card rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">{title}</p>
      <div className="flex justify-between items-end">
        <div>
          <div className="text-2xl font-semibold text-parchment">{current}</div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {current > 0 && currentStart ? `since ${formatStart(currentStart)}` : 'current'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-neutral-400">{longest}</div>
          <div className="text-xs text-neutral-600 mt-0.5">
            {longest > 0 && longestStart
              ? `${formatStart(longestStart)} – ${formatStart(longestEnd)}`
              : 'longest'}
          </div>
        </div>
      </div>
    </div>
  );
}

// Daily / Weekly / Monthly reading streaks — three tiles in a row.
// Each tile pulls from the matching server-side counter and uses the
// matching date formatter so "since Mon, Mar 4" / "since Mar 2026" /
// "since 2026-W10 Monday" each read in their natural granularity.
export default function Streaks({ streaks }) {
  return (
    <Section title="Streaks">
      <div className="grid grid-cols-3 gap-3">
        <StreakTile
          title="Daily"
          current={streaks.days.current}
          currentStart={streaks.days.currentStart}
          longest={streaks.days.longest}
          longestStart={streaks.days.longestStart}
          longestEnd={streaks.days.longestEnd}
          formatStart={fmtShortDate}
        />
        <StreakTile
          title="Weekly"
          current={streaks.weeks.current}
          currentStart={streaks.weeks.currentStart}
          longest={streaks.weeks.longest}
          longestStart={streaks.weeks.longestStart}
          longestEnd={streaks.weeks.longestEnd}
          formatStart={fmtIsoWeekMonday}
        />
        <StreakTile
          title="Monthly"
          current={streaks.months.current}
          currentStart={streaks.months.currentStart}
          longest={streaks.months.longest}
          longestStart={streaks.months.longestStart}
          longestEnd={streaks.months.longestEnd}
          formatStart={fmtShortMonth}
        />
      </div>
    </Section>
  );
}
