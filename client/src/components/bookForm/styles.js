export const input         = 'w-full bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150';
export const inputFilled   = 'w-full bg-neutral-800 border border-oak/40 ring-1 ring-oak/15 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-2 focus:ring-oak/20 transition-colors duration-150';
export const inputNoWidth  = 'bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2.5 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-oak/50 focus:ring-1 focus:ring-oak/20 transition-colors duration-150';
export const label         = 'block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider';

// Tooltip cheat sheet shown via the native title= attribute next to "Markdown
// supported" labels. CommonMark only — react-markdown is used without
// remark-gfm, so tables/strikethrough/task lists are out of scope.
export const MARKDOWN_HINT =
  '**bold**   *italic*   `code`\n' +
  '[link](https://example.com)\n' +
  '- bulleted list\n' +
  '1. numbered list\n' +
  '> blockquote\n' +
  '# heading';

// onKeyDown handler for textareas inside the BookForm — Cmd/Ctrl+Enter
// submits the parent form so the user can save without leaving the
// keyboard. Plain Enter still inserts a newline (default behavior).
// Uses e.target.form so nothing has to be wired through props.
export function submitOnModEnter(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    e.target.form?.requestSubmit();
  }
}
