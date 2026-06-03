// Remark plugin: rewrite `#123` tokens inside markdown text leaves into
// link nodes targeting `spine-book:123`. The custom URL scheme lets the
// react-markdown `a` renderer recognise these and swap them for BookRef
// — keeping the title resolution in the React layer while letting
// markdown handle the surrounding prose. Skips text inside code, inline
// code, and existing links so `#123` in a fenced block or already-linked
// anchor stays literal.
const BOOK_REF_RE = /\B#(\d+)\b/g;

function transform(node) {
  if (!node || node.type === 'inlineCode' || node.type === 'code' || node.type === 'link') return;
  if (!Array.isArray(node.children)) return;
  const next = [];
  for (const child of node.children) {
    if (child.type !== 'text') {
      transform(child);
      next.push(child);
      continue;
    }
    const value = child.value;
    const matches = [...value.matchAll(BOOK_REF_RE)];
    if (matches.length === 0) { next.push(child); continue; }
    let cursor = 0;
    for (const m of matches) {
      if (m.index > cursor) next.push({ type: 'text', value: value.slice(cursor, m.index) });
      next.push({
        type: 'link',
        url: `spine-book:${m[1]}`,
        children: [{ type: 'text', value: m[0] }],
      });
      cursor = m.index + m[0].length;
    }
    if (cursor < value.length) next.push({ type: 'text', value: value.slice(cursor) });
  }
  node.children = next;
}

export default function remarkBookRefs() {
  return (tree) => transform(tree);
}
