import { useRef } from 'react';
import { useBookMentions } from '../../hooks/useBookMentions.js';
import MentionMenu from './MentionMenu.jsx';

// Drop-in <textarea> replacement that opens a book picker when the user
// types `@`. Selecting a result inserts `[#NNN](spine-book:NNN) ` which
// the BookDetail markdown renderer (proseMarkdown `a` override + BookRef)
// turns into a live link to the target book.
//
// API differs from a raw textarea in one place: `onValue(string)`
// replaces `onChange(e)`, since the hook needs to splice text at the
// caret rather than echo the DOM event. `onKeyDown` is chained — the
// mention picker handles ArrowUp/Down/Enter/Tab/Esc only when its menu
// is open, and forwards everything else (including Ctrl/Cmd+Enter for
// submitOnModEnter).
export default function MentionTextarea({ value, onValue, onKeyDown, onBlur, ...props }) {
  const ref = useRef(null);
  const mentions = useBookMentions(ref, value, onValue);

  const handleKeyDown = (e) => {
    if (mentions.onKeyDown(e)) return;
    if (onKeyDown) onKeyDown(e);
  };

  // Close the picker when focus leaves the textarea. MentionMenu's
  // option buttons use onMouseDown + preventDefault so clicking a
  // result doesn't fire blur first — that lets us close immediately
  // here instead of timing-out, and dodges the race where a stray
  // re-render reopens the menu after a select.
  const handleBlur = (e) => {
    mentions.close();
    if (onBlur) onBlur(e);
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        {...props}
      />
      <MentionMenu
        menu={mentions.menu}
        results={mentions.results}
        onSelect={mentions.select}
        onClose={mentions.close}
      />
    </div>
  );
}
