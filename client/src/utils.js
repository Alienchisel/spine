export function sortTitle(title) {
  return (title || '').replace(/^(the|a|an)\s+/i, '');
}

export function realTagNames(tags) {
  return (tags ?? []).filter(t => !t.virtual).map(t => t.name);
}
