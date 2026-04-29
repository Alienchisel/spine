export function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

export function formatPartialDate(val) {
  if (!val) return null;
  const parts = val.split('-');
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return new Date(`${val}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return formatDate(val);
}
