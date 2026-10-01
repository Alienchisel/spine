import { nrm } from '../utils.js';

// Every whitespace-separated token of the query appears in the text,
// compared through nrm() — the same folding the server search applies — so
// palette filtering and qualifier autocomplete (`author:bohm`) match
// "Böhm-Bawerk", curly apostrophes, exotic hyphens and so on. It used to
// only lowercase.
export function matchesQuery(text, q) {
  if (!q) return true;
  const haystack = nrm(text);
  const tokens = nrm(q).split(/\s+/).filter(Boolean);
  return tokens.every(t => haystack.includes(t));
}
