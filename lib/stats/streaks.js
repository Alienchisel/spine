import { addDays, toISOWeek, toYearMonth, nextDay, nextWeek, nextMonth, prevMonth } from './dates.js';

// Given a sorted ascending array of period identifiers (dates, weeks, or
// months), returns the longest consecutive run found and the current run if
// it ends at the present period or the immediately previous one. Also
// reports the period identifiers at the start/end of each run so callers
// can format them as date ranges. Period IDs are returned verbatim
// (YYYY-MM-DD for days, YYYY-Www for weeks, YYYY-MM for months).
function longestAndCurrent(periods, nextFn, currentPeriod, prevPeriod) {
  if (!periods.length) return { current: 0, longest: 0, longestStart: null, longestEnd: null, currentStart: null, currentEnd: null };
  let longest = 1, run = 1;
  let longestStart = periods[0], longestEnd = periods[0];
  let runStart = periods[0];
  for (let i = 1; i < periods.length; i++) {
    if (periods[i] === nextFn(periods[i - 1])) {
      run += 1;
    } else {
      run = 1;
      runStart = periods[i];
    }
    if (run > longest) {
      longest = run;
      longestStart = runStart;
      longestEnd = periods[i];
    }
  }
  const last = periods[periods.length - 1];
  const isCurrent = (last === currentPeriod || last === prevPeriod);
  return {
    current:      isCurrent ? run : 0,
    longest,
    longestStart, longestEnd,
    currentStart: isCurrent ? runStart : null,
    currentEnd:   isCurrent ? last     : null,
  };
}

// Calculates day/week/month streaks from a list of distinct activity dates
// (ISO YYYY-MM-DD, ascending). Returns { days, weeks, months } where each
// has { current, longest }.
export function calcStreaks(dates) {
  if (!dates.length) return {
    days:   { current: 0, longest: 0 },
    weeks:  { current: 0, longest: 0 },
    months: { current: 0, longest: 0 },
  };

  const today  = new Date().toLocaleDateString('en-CA');
  const weeks  = [...new Set(dates.map(toISOWeek))].sort();
  const months = [...new Set(dates.map(toYearMonth))].sort();

  return {
    days:   longestAndCurrent(dates,  nextDay,   today,             addDays(today, -1)),
    weeks:  longestAndCurrent(weeks,  nextWeek,  toISOWeek(today),  toISOWeek(addDays(today, -7))),
    months: longestAndCurrent(months, nextMonth, toYearMonth(today), prevMonth(toYearMonth(today))),
  };
}
