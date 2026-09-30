// True when a keydown is a bare single-key shortcut press: no Ctrl / ⌘ /
// Alt / Shift, not an auto-repeat, and not typed into an editable field.
// Page-level letter and digit shortcuts must check this before acting.
// Without the modifier check, browser chords fired them as well —
// Ctrl/⌘+L focuses the address bar but also linked a duplicate cluster
// as editions, Ctrl+U (view source) undid the last audit fill, and
// Ctrl+1–9 (switch tab) picked and saved wizard option N. Without the
// repeat check, a held key applied itself to card after card.
export function isBareShortcut(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false;
  const el = e.target;
  if (!el) return true;
  const tag = el.tagName;
  return !(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable);
}
