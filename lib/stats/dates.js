// Pure date helpers used by streak math. ISO-week and year-month identifiers
// are strings ('2026-W17', '2026-04') so they can be sorted lexically and
// compared with === — no Date objects needed once parsed.

export function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function toISOWeek(dateStr) {
  const d = new Date(dateStr);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function toYearMonth(dateStr) {
  return dateStr.slice(0, 7);
}

export function nextDay(d) { return addDays(d, 1); }

export function nextWeek(w) {
  const [y, wn] = w.split('-W').map(Number);
  const weeksInYear = toISOWeek(`${y}-12-28`) === `${y}-W53` ? 53 : 52;
  return wn < weeksInYear ? `${y}-W${String(wn + 1).padStart(2, '0')}` : `${y + 1}-W01`;
}

export function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo > 1 ? `${y}-${String(mo - 1).padStart(2, '0')}` : `${y - 1}-12`;
}

export function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo < 12 ? `${y}-${String(mo + 1).padStart(2, '0')}` : `${y + 1}-01`;
}
