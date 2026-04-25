export function sortTitle(title) {
  return (title || '').replace(/^(the|a|an)\s+/i, '');
}
