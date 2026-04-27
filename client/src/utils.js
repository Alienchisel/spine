// authors: [{id, name}] or [string]
export function formatAuthors(authors) {
  if (!authors?.length) return null;
  const names = authors.map(a => (typeof a === 'string' ? a : a.name));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]} et al.`;
}

export function sortTitle(title) {
  return (title || '').replace(/^(the|a|an)\s+/i, '');
}

export function realTagNames(tags) {
  return (tags ?? []).filter(t => !t.virtual).map(t => t.name);
}
