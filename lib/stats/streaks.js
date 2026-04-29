import { addDays, toISOWeek, toYearMonth, nextDay, nextWeek, nextMonth, prevMonth } from './dates.js';

// Given a sorted ascending array of period identifiers (dates, weeks, or
// months), returns the longest consecutive run found and the current run if
// it ends at the present period or the immediately previous one.
function longestAndCurrent(periods, nextFn, currentPeriod, prevPeriod) {
  if (!periods.length) return { current: 0, longest: 0 };
  let longest = 1, run = 1;
  for (let i = 1; i < periods.length; i++) {
    run = periods[i] === nextFn(periods[i - 1]) ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const last = periods[periods.length - 1];
  const current = (last === currentPeriod || last === prevPeriod) ? run : 0;
  return { current, longest };
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

  const today  = new Date().toISOString().slice(0, 10);
  const weeks  = [...new Set(dates.map(toISOWeek))].sort();
  const months = [...new Set(dates.map(toYearMonth))].sort();

  return {
    days:   longestAndCurrent(dates,  nextDay,   today,             addDays(today, -1)),
    weeks:  longestAndCurrent(weeks,  nextWeek,  toISOWeek(today),  toISOWeek(addDays(today, -7))),
    months: longestAndCurrent(months, nextMonth, toYearMonth(today), prevMonth(toYearMonth(today))),
  };
}
