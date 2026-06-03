import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';

// Trigger: `@` at start-of-text or after whitespace, followed by up to
// 40 non-whitespace / non-`@` chars. The 40-char cap stops a runaway
// match from eating an entire paragraph when the user types `@` and
// then keeps typing without selecting a result.
const MENTION_RE = /(?:^|\s)@([^\s@]{0,40})$/;

// Reads the textarea's caret, looks for `@query` immediately before it,
// and exposes a small menu state + keyboard handler. Inserts an explicit
// markdown link `[#NNN](spine-book:NNN)` on select so the rendered field
// resolves it via the proseMarkdown `a` override + BookRef. Picker-only
// is intentional: bare `#NNN` autolinking false-positives heavily on
// Amazon/Goodreads blurbs ("the #1 New York Times bestseller …").
export function useBookMentions(textareaRef, value, onValue) {
  const [menu, setMenu] = useState(null); // { query, matchStart, selectedIdx }
  const [results, setResults] = useState([]);
  const sessionRef = useRef(0);

  const refreshDetection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) { setMenu(null); return; }
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) { setMenu(null); return; }
    const before = value.slice(0, pos);
    const m = before.match(MENTION_RE);
    if (!m) { setMenu(null); return; }
    const matchStart = pos - m[1].length - 1;
    setMenu(prev => (prev && prev.matchStart === matchStart && prev.query === m[1])
      ? prev
      : { query: m[1], matchStart, selectedIdx: 0 });
  }, [value, textareaRef]);

  useEffect(() => { refreshDetection(); }, [refreshDetection]);

  // Caret may move without a value change (arrow keys, clicks). Listen
  // for those so the menu opens/closes as the caret crosses an `@`
  // boundary.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const handler = () => refreshDetection();
    ta.addEventListener('click', handler);
    ta.addEventListener('keyup', handler);
    return () => {
      ta.removeEventListener('click', handler);
      ta.removeEventListener('keyup', handler);
    };
  }, [textareaRef, refreshDetection]);

  // Debounced search. Empty-query opens the menu with recent activity
  // (most recently updated books) so `@` followed by no chars is still
  // useful as a quick picker.
  useEffect(() => {
    if (!menu) { setResults([]); return; }
    const session = ++sessionRef.current;
    const q = menu.query.trim();
    const t = setTimeout(() => {
      const p = q
        ? api.getBooks({ q, limit: 8 })
        : api.getBooks({ sort: 'updated', limit: 8 });
      p.then(data => {
        if (session !== sessionRef.current) return;
        setResults(data?.books ?? []);
      }).catch(() => {
        if (session !== sessionRef.current) return;
        setResults([]);
      });
    }, 120);
    return () => clearTimeout(t);
  }, [menu?.query]);

  const select = useCallback((idx) => {
    const book = results[idx];
    if (!book || !menu) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = value.slice(0, menu.matchStart);
    const after = value.slice(pos);
    const insert = `[#${book.id}](spine-book:${book.id}) `;
    onValue(before + insert + after);
    setMenu(null);
    requestAnimationFrame(() => {
      const newPos = (before + insert).length;
      ta.setSelectionRange(newPos, newPos);
      ta.focus();
    });
  }, [results, menu, value, onValue, textareaRef]);

  const close = useCallback(() => setMenu(null), []);

  const onKeyDown = useCallback((e) => {
    if (!menu) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMenu(m => (m && results.length) ? { ...m, selectedIdx: (m.selectedIdx + 1) % results.length } : m);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMenu(m => (m && results.length) ? { ...m, selectedIdx: (m.selectedIdx - 1 + results.length) % results.length } : m);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!results.length) return false;
      e.preventDefault();
      select(menu.selectedIdx);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMenu(null);
      return true;
    }
    return false;
  }, [menu, results, select]);

  return { menu, results, onKeyDown, select, close };
}
