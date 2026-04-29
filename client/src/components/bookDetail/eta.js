// Estimates how many more reading sessions are needed to finish a book based
// on the recent reading_log entries. Returns null when there isn't enough
// signal (no log, less than two active sessions, or projected sessions > 60).
export function computeEta(log, remaining, isAudiobook) {
  if (!log?.length || remaining <= 0) return null;
  const key = isAudiobook ? 'minutes_read' : 'pages_read';
  const active = log.filter(e => (e[key] || 0) > 0);
  if (active.length < 2) return null;
  const recent = active.slice(0, Math.min(10, active.length));
  const avg = recent.reduce((sum, e) => sum + e[key], 0) / recent.length;
  if (avg <= 0) return null;
  const sessions = Math.ceil(remaining / avg);
  if (sessions > 60) return null;

  let finishDate = null;
  if (recent.length >= 2 && recent[0].date && recent[recent.length - 1].date) {
    const newest = new Date(recent[0].date + 'T12:00:00');
    const oldest = new Date(recent[recent.length - 1].date + 'T12:00:00');
    const daySpan = (newest - oldest) / 86400000;
    if (daySpan > 0) {
      const sessionsPerDay = (recent.length - 1) / daySpan;
      const daysLeft = Math.round(sessions / sessionsPerDay);
      if (daysLeft <= 365) {
        finishDate = new Date();
        finishDate.setDate(finishDate.getDate() + daysLeft);
      }
    }
  }

  return { sessions, finishDate };
}
