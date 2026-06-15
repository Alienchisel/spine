import { nrm } from '../../db.js';

// Google-style search DSL for the `q` parameter.
//
// Grammar:
//   expr   := orExpr
//   orExpr := andExpr (OR andExpr)*       -- 'OR' must be uppercase
//   andExpr := unary unary*               -- whitespace = AND (implicit)
//   unary  := ('-' | NOT) unary | atom    -- '-' or uppercase 'NOT' negates
//   atom   := '(' expr ')' | '"phrase"' | qualifier ':' value | term
//
// Qualifier syntax pins a term to a single surface: `author:vance` matches
// only the authors join, `tag:Sci-Fi` only the tags join, etc. Without a
// qualifier a bare term matches across all six surfaces (title, series,
// tag, author, narrator, translator). Quoted values work after a qualifier
// too: `series:"Book of the New Sun"`.
//
// Lowercase 'or' / 'not' are treated as literal terms, so titles like
// "Pride or Prejudice" don't get parsed as boolean operators.

const SPECIAL_RE = /[\s()"]/;
const QUALIFIERS = new Set(['title', 'series', 'tag', 'author', 'narrator', 'translator', 'publisher', 'list']);
// Sentence punctuation that's load-bearing in titles ("Volume 2: Subtitle",
// "Volume 2, Subtitle", "Mr.", "the end.") but should not block a substring
// match. Stripped from term edges only — internal punctuation ("5.5",
// "Anti-natalism") survives. The stored column doesn't need the same
// treatment because LIKE is substring-based: a query for "representation"
// already matches stored "representation," / "representation:" etc.
const EDGE_PUNCT_RE = /^[,:;.!?]+|[,:;.!?]+$/g;

export function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
    if (c === '"') {
      const end = input.indexOf('"', i + 1);
      const close = end === -1 ? input.length : end;
      const value = input.slice(i + 1, close);
      if (value) tokens.push({ type: 'PHRASE', value });
      i = close === input.length ? close : close + 1;
      continue;
    }
    if (c === '-') {
      // '-' acts as NOT before any non-space character — including '(' and '"'
      // — so '-(a OR b)' and '-"phrase"' negate the way Google does. Lone '-'
      // or '- foo' (followed by space) is discarded.
      const next = input[i + 1];
      if (next != null && !/\s/.test(next) && next !== ')') {
        tokens.push({ type: 'NOT' });
        i++;
        continue;
      }
      i++;
      continue;
    }
    // Qualifier prefix: a known qualifier name followed by ':' pins the
    // value that follows to a single surface. Value may be a phrase
    // (`author:"Jack Vance"`) or a bare word (`tag:Sci-Fi`). An unknown
    // qualifier or stray colon falls through to the plain-term branch.
    let n = i;
    while (n < input.length && /[a-zA-Z]/.test(input[n])) n++;
    const namePart = input.slice(i, n).toLowerCase();
    if (input[n] === ':' && QUALIFIERS.has(namePart) && namePart.length > 0) {
      const valueStart = n + 1;
      if (input[valueStart] === '"') {
        const end = input.indexOf('"', valueStart + 1);
        const close = end === -1 ? input.length : end;
        const value = input.slice(valueStart + 1, close);
        if (value) tokens.push({ type: 'QTERM', field: namePart, value });
        i = close === input.length ? close : close + 1;
        continue;
      }
      let k = valueStart;
      // Value runs to the next whitespace/paren/quote — colons are allowed
      // inside the value so a tag or series name that happens to contain
      // one (e.g. `series:Hugo:Best Novel`) is captured intact rather than
      // splitting at the first inner colon.
      while (k < input.length && !SPECIAL_RE.test(input[k])) k++;
      const value = input.slice(valueStart, k).replace(EDGE_PUNCT_RE, '');
      if (value) tokens.push({ type: 'QTERM', field: namePart, value });
      i = k;
      continue;
    }

    let j = i;
    while (j < input.length && !SPECIAL_RE.test(input[j])) j++;
    const word = input.slice(i, j);
    if (word === 'OR')      tokens.push({ type: 'OR' });
    else if (word === 'NOT') tokens.push({ type: 'NOT' });
    else {
      // Strip edge punctuation so "Representation:" matches stored
      // "Representation,". A token that's nothing but punctuation collapses
      // to empty and is dropped, so a stray ',' in the query doesn't drag
      // in an unsatisfiable atom that would AND-out the rest of the query.
      const stripped = word.replace(EDGE_PUNCT_RE, '');
      if (stripped) tokens.push({ type: 'TERM', value: stripped });
    }
    i = j;
  }
  return tokens;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek()    { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }

  parseExpr() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.peek()?.type === 'OR') {
      this.consume();
      const right = this.parseAnd();
      if (right) left = left ? { type: 'or', left, right } : right;
    }
    return left;
  }

  parseAnd() {
    let left = this.parseUnary();
    while (this.peek() && this.peek().type !== 'OR' && this.peek().type !== 'RPAREN') {
      const right = this.parseUnary();
      if (right) left = left ? { type: 'and', left, right } : right;
    }
    return left;
  }

  parseUnary() {
    if (this.peek()?.type === 'NOT') {
      this.consume();
      const inner = this.parseUnary();
      return inner ? { type: 'not', node: inner } : null;
    }
    return this.parseAtom();
  }

  parseAtom() {
    const t = this.peek();
    if (!t) return null;
    if (t.type === 'LPAREN') {
      this.consume();
      const inner = this.parseExpr();
      if (this.peek()?.type === 'RPAREN') this.consume();
      return inner;
    }
    if (t.type === 'TERM' || t.type === 'PHRASE') {
      this.consume();
      return { type: 'match', value: t.value };
    }
    if (t.type === 'QTERM') {
      this.consume();
      return { type: 'qmatch', field: t.field, value: t.value };
    }
    // Stray OR / RPAREN — skip so the parser doesn't loop.
    this.consume();
    return null;
  }
}

// Drop ')' tokens that have no matching earlier '(' so a stray close-paren
// doesn't silently swallow the rest of the query. Mismatched ')' ends the
// AND-loop early (its guard treats RPAREN as a sentinel for the LPAREN
// handler), which would lose every token after it.
function dropUnmatchedRparens(tokens) {
  let depth = 0;
  return tokens.filter(t => {
    if (t.type === 'LPAREN') { depth++; return true; }
    if (t.type === 'RPAREN') {
      if (depth === 0) return false;
      depth--;
    }
    return true;
  });
}

export function parse(input) {
  const tokens = dropUnmatchedRparens(tokenize(input));
  return new Parser(tokens).parseExpr();
}

// Returns { sql, params } for "this literal appears in any searchable surface".
// Identical to the original q-clause; kept as one helper so AST nodes plug in.
//
// Both sides of the comparison run through nrm(): stored values are
// folded at query time, and the literal is folded once in JS before
// being parameterised. So "thermae romae" matches "Thermæ Rōmæ", "cafe"
// matches "café", etc. The double-fold (JS + SQL) is intentional — a
// SQL-side fold of just the column would still leave the literal
// unnormalised and miss the match.
function atomSql(literal) {
  if (!literal) return null;
  // A literal that's pure diacritics / ligature combiners (e.g. "´" alone)
  // collapses to '' under nrm — without this guard, `like` becomes '%%'
  // and matches every row. We can't return null here, because astToSql
  // treats null branches as collapsible: `cafe AND ´` would silently
  // become just `cafe` and match all cafes. Emit an unsatisfiable atom
  // instead so AND/OR composition stays sound.
  const normalized = nrm(literal);
  if (!normalized) return { sql: '(0 = 1)', params: [] };
  const like = `%${normalized}%`;
  const sql =
    "(nrm(title) LIKE ? OR nrm(COALESCE(series,'')) LIKE ?" +
    " OR id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE nrm(t.name) LIKE ?)" +
    " OR id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE nrm(a.name) LIKE ?)" +
    " OR id IN (SELECT bn.book_id FROM book_narrators bn JOIN narrators n ON bn.narrator_id = n.id WHERE nrm(n.name) LIKE ?)" +
    " OR id IN (SELECT btr.book_id FROM book_translators btr JOIN translators tr ON btr.translator_id = tr.id WHERE nrm(tr.name) LIKE ?))";
  return { sql, params: [like, like, like, like, like, like] };
}

// Single-surface variant: emits the LIKE clause for exactly one column or
// join, used when the user has pinned a term to a qualifier (`author:vance`,
// `tag:Sci-Fi`, etc.). Tag matches use real (stored) tags only — virtual
// tags computed from book columns aren't part of the tags table, so
// `tag:Long` will not pick up the virtual Long tag. The FilterPanel still
// surfaces virtual tags for explicit filtering.
function qatomSql(field, literal) {
  if (!literal) return null;
  const normalized = nrm(literal);
  if (!normalized) return { sql: '(0 = 1)', params: [] };
  const like = `%${normalized}%`;
  let sql;
  switch (field) {
    case 'title':      sql = 'nrm(title) LIKE ?'; break;
    case 'series':     sql = "nrm(COALESCE(series,'')) LIKE ?"; break;
    case 'publisher':  sql = "nrm(COALESCE(publisher,'')) LIKE ?"; break;
    case 'tag':        sql = 'id IN (SELECT bt.book_id FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE nrm(t.name) LIKE ?)'; break;
    case 'author':     sql = 'id IN (SELECT ba.book_id FROM book_authors ba JOIN authors a ON ba.author_id = a.id WHERE nrm(a.name) LIKE ?)'; break;
    case 'narrator':   sql = 'id IN (SELECT bn.book_id FROM book_narrators bn JOIN narrators n ON bn.narrator_id = n.id WHERE nrm(n.name) LIKE ?)'; break;
    case 'translator': sql = 'id IN (SELECT btr.book_id FROM book_translators btr JOIN translators tr ON btr.translator_id = tr.id WHERE nrm(tr.name) LIKE ?)'; break;
    case 'list':       sql = 'id IN (SELECT lb.book_id FROM list_books lb JOIN lists l ON l.id = lb.list_id WHERE nrm(l.name) LIKE ?)'; break;
    default:           return null;
  }
  return { sql: `(${sql})`, params: [like] };
}

function astToSql(node) {
  if (!node) return null;
  if (node.type === 'match')  return atomSql(node.value);
  if (node.type === 'qmatch') return qatomSql(node.field, node.value);
  if (node.type === 'not') {
    const inner = astToSql(node.node);
    if (!inner) return null;
    return { sql: `NOT ${inner.sql}`, params: inner.params };
  }
  if (node.type === 'and' || node.type === 'or') {
    const op   = node.type === 'and' ? ' AND ' : ' OR ';
    const left  = astToSql(node.left);
    const right = astToSql(node.right);
    if (!left)  return right;
    if (!right) return left;
    return { sql: `(${left.sql}${op}${right.sql})`, params: [...left.params, ...right.params] };
  }
  return null;
}

// Public: turn a search-bar string into a SQL fragment + params, or null
// if the string contains nothing matchable.
export function buildSearchCondition(q) {
  if (!q || !q.trim()) return null;
  return astToSql(parse(q));
}
