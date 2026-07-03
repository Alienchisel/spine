import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { todayCardQuery } from './TodayCard.jsx';
import { fmtShortDate } from '../utils.js';

// Horizontal day-card carousel for /today (1.226+). Replaces the
// arrow-based DayNav. The centre slot is the active day's full card
// (rendered by the consumer as children); the left and right slots
// are thin slivers that hint at the adjacent days' cards via the
// card-type accent stripe. Click a sliver to navigate to that day.
//
// Past lookback caps at 14 days from today — same window as the
// today_card_history repetition guard. Past Connections / Past
// Reading Paths archives cover anything older.
//
// The right slot when viewing today is a face-down "Tomorrow" tile:
// no accent, dashed border, question mark, unclickable. This is the
// only intentional asymmetry — tomorrow's card is supposed to be a
// daily surprise, so peeking is structurally disallowed (any visible
// hint would echo the manual-grading spoiler concern that drove the
// peek=true plumbing in the first place).

const PAST_CAP_DAYS = 14;

// Accent stripe colours per card type. The bg-* literals must appear
// as whole strings somewhere in client source so Tailwind's JIT keeps
// them. The text-* analogues already live in TodayCard.jsx; these
// bg-* variants are unique to the carousel slivers.
const TYPE_ACCENT = {
  loved_resurface:       'bg-rose-400/70',
  slow_burn:             'bg-amber-400/70',
  recent_acquisition:    'bg-sky-400/70',
  forgotten_readlist:    'bg-sky-400/70',
  author_barely_opened:  'bg-violet-400/70',
  loved_author_followup: 'bg-pink-400/70',
  series_next_volume:    'bg-green-400/70',
  anniversary:           'bg-orange-400/70',
  author_anniversary:    'bg-fuchsia-400/70',
  personal_anniversary:  'bg-yellow-400/70',
  connection:            'bg-teal-400/70',
  reading_path:          'bg-emerald-400/70',
};

// Calendar-day shift via setDate — no JS ms math, DST-safe per the
// project's no-ms-arithmetic-for-days rule.
function shiftDay(dateStr, delta) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA');
}

// (a - b) in whole calendar days. Inputs are YYYY-MM-DD strings; noon
// offsets sidestep DST edges in the subtraction.
function diffDays(a, b) {
  const dA = new Date(`${a}T12:00:00`);
  const dB = new Date(`${b}T12:00:00`);
  return Math.round((dA - dB) / 86_400_000);
}

// Shared sliver shell. `side` controls the accent stripe edge (inner
// edge of each slot — right edge on the left sliver, left edge on the
// right sliver) and the outer rounded corner. `type` is the resolved
// card type or null while loading; null shows a neutral stripe.
function SliverShell({ to, side, type, label, ariaLabel }) {
  const accent = type && TYPE_ACCENT[type] ? TYPE_ACCENT[type] : 'bg-neutral-700/40';
  const stripeEdge = side === 'left' ? 'right-0' : 'left-0';
  const outerRound = side === 'left' ? 'rounded-l-lg border-l' : 'rounded-r-lg border-r';
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className={`flex-none w-[9%] min-w-[40px] relative ${outerRound} border-y border-neutral-800/60 bg-neutral-900/30 hover:bg-neutral-900/60 transition-colors group`}
    >
      <div className={`absolute inset-y-0 ${stripeEdge} w-1 ${accent}`} />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500 group-hover:text-neutral-300 transition-colors -rotate-90 whitespace-nowrap">
          {label}
        </span>
      </div>
    </Link>
  );
}

// Past-day sliver. Peeks the card type without persisting (peek=true)
// so a sliver-only glance doesn't fill in history for days the user
// never opened. The neutral stripe shows during the fetch, then
// swaps in the type accent once the peek resolves. Shares its query
// key with the full TodayCard for the same date, so clicking through
// renders the peeked card straight from cache.
function PastSliver({ date }) {
  const { data: card } = useQuery(todayCardQuery(date, true));
  const type = card?.type || null;
  return (
    <SliverShell
      to={`/today?date=${date}`}
      side="left"
      type={type}
      label={fmtShortDate(date)}
      ariaLabel={`View card from ${fmtShortDate(date)}`}
    />
  );
}

// Right-side sliver when the centre is a past day. Points either to
// the next past day or, when next === currentDate, back to today. The
// peek fetch is skipped for the today case so we use the persisted
// path rather than recompute.
function FutureSliver({ date, currentDate }) {
  const isToday = date === currentDate;
  const { data: card } = useQuery(
    todayCardQuery(isToday ? undefined : date, !isToday)
  );
  const type = card?.type || null;
  const to = isToday ? '/today' : `/today?date=${date}`;
  const label = isToday ? 'Today' : fmtShortDate(date);
  return (
    <SliverShell
      to={to}
      side="right"
      type={type}
      label={label}
      ariaLabel={`View card from ${label}`}
    />
  );
}

// Face-down "Tomorrow" tile. Sits in the right slot when the centre
// is today. Deliberately unclickable — tomorrow's card is the next-
// day surprise, and any preview would defeat the ritual. The rotated
// "TOMORROW" label mirrors the past sliver's rhythm so the row reads
// as one coherent strip rather than two adjacent strips plus a lone
// blank tile.
function MysteryTomorrowSliver() {
  return (
    <div
      aria-hidden="true"
      title="Tomorrow"
      className="flex-none w-[9%] min-w-[40px] relative rounded-r-lg border-r border-y border-dashed border-neutral-800/60 bg-neutral-900/15"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] uppercase tracking-wide text-neutral-700 -rotate-90 whitespace-nowrap">
          Tomorrow
        </span>
      </div>
    </div>
  );
}

// Empty spacer for symmetry when the past sliver is suppressed past
// the 14-day cap. Keeps the centre card aligned the same width on
// every navigation so the layout doesn't jump as you scroll backward.
function EmptySliver({ side }) {
  const round = side === 'left' ? 'rounded-l-lg' : 'rounded-r-lg';
  return (
    <div
      aria-hidden="true"
      className={`flex-none w-[9%] min-w-[40px] ${round} border border-dashed border-neutral-900/40 bg-neutral-950/30`}
    />
  );
}

export default function TodayCarousel({ viewedDate, currentDate, children }) {
  const daysFromToday = diffDays(currentDate, viewedDate);  // 0 today, 1 yesterday, ...
  const onToday = daysFromToday === 0;

  const prev = shiftDay(viewedDate, -1);
  const next = shiftDay(viewedDate, +1);

  // Past sliver hides once the previous day would step outside the
  // 14-day window from today. After that, the archive pages take over.
  const showPastSliver = diffDays(currentDate, prev) <= PAST_CAP_DAYS;

  return (
    <div className="flex items-stretch gap-2">
      {showPastSliver ? <PastSliver date={prev} /> : <EmptySliver side="left" />}
      <div className="flex-1 min-w-0">{children}</div>
      {onToday
        ? <MysteryTomorrowSliver />
        : <FutureSliver date={next} currentDate={currentDate} />}
    </div>
  );
}
