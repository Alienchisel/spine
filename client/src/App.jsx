import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import { ConfirmModalProvider } from './components/ConfirmModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { api } from './api.js';

// Layout route for the data router defined in main.jsx — renders the
// shared shell (Nav + main wrapper) and the per-route page via <Outlet/>.
// ConfirmModalProvider must wrap <Outlet/> so every page can call
// useConfirm() through context.
export default function App() {
  const navigate = useNavigate();
  // Plain `R` jumps to a random book — Wikipedia/Letterboxd convention.
  // Guarded so input fields, textareas, and contenteditable surfaces
  // (bio editor, search bars, etc.) still get the keystroke. Any
  // modifier (Ctrl/Meta/Alt/Shift) bows out so Ctrl-R stays the
  // browser reload and Shift-R is free as an escalation if R alone
  // ever proves too misfire-prone.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'r' && e.key !== 'R') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement;
      if (el && (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      )) return;
      e.preventDefault();
      api.getRandomBook()
        .then(({ id }) => navigate(`/books/${id}`))
        .catch(() => {});
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // The gutter art's height is captured once at mount and only updates
  // on substantial window resizes — so transient viewport jitters from
  // Firefox's find bar (Ctrl-F shrinks the viewport by ~60 px) don't
  // rescale the art. The 120 px threshold is well above find bar /
  // soft-keyboard sized changes but well below any realistic window
  // resize, and the debounce coalesces drag-resizes into a single
  // update. CSS units (100vh / 100lvh / 100dvh) don't isolate the
  // find bar on Firefox desktop, so the gating has to be JS-side.
  const [gutterHeight, setGutterHeight] = useState(0);
  useEffect(() => {
    setGutterHeight(window.innerHeight);
    let last = window.innerHeight;
    let timeout = null;
    function onResize() {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        const h = window.innerHeight;
        if (Math.abs(h - last) > 120) {
          last = h;
          setGutterHeight(h);
        }
      }, 200);
    }
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timeout) clearTimeout(timeout);
    };
  }, []);
  // Native <input type="date"> opens a browser calendar overlay that's
  // absolutely positioned at the page coordinates of the input *at open
  // time*. The overlay doesn't follow the input on scroll, so a wheel
  // tick leaves it floating mid-page detached from its field. Blur on
  // any window scroll/wheel to close it cleanly.
  useEffect(() => {
    function closeIfDate() {
      const el = document.activeElement;
      if (el?.tagName === 'INPUT' && el.type === 'date') el.blur();
    }
    window.addEventListener('wheel', closeIfDate, { passive: true });
    window.addEventListener('scroll', closeIfDate, true);
    return () => {
      window.removeEventListener('wheel', closeIfDate);
      window.removeEventListener('scroll', closeIfDate, true);
    };
  }, []);

  return (
    <ConfirmModalProvider>
      <div className="min-h-screen bg-neutral-950">
        {/* Gutter atmosphere art. ONE source image at
            client/public/gutter.png holds both compositions side-by-
            side with a dark middle; each gutter wrapper clips to its
            half via overflow-hidden, with the inner img anchored
            left or right so each side reveals its own composition.
            The source needs to be roughly 2:3 portrait with the lit
            compositions pushed to the outer edges (middle is the dark
            void). Width is sized to the exact gutter at any viewport
            via calc((100vw - 1280px) / 2) — content is max-w-7xl
            centered, so the gutter is half the leftover viewport on
            each side. Height comes from the JS-managed gutterHeight
            so Ctrl-F's find bar doesn't rescale the art. A mask fade
            on the inner edge blends the dark middle into the page bg.
            Hidden below xl: where the gutter collapses to zero.
            Negative z-index isn't safe here (static parents don't
            create a stacking context for negative-z kids and the
            wrapper's bg would hide it) — DOM order + pointer-events-
            none does the stacking instead. */}
        {gutterHeight > 0 && (
          <div
            className="hidden xl:block fixed top-0 left-0 w-[calc((100vw-1280px)/2)] overflow-hidden pointer-events-none select-none [mask-image:linear-gradient(to_right,black_70%,transparent)]"
            style={{ height: `${gutterHeight}px` }}
            aria-hidden="true"
          >
            <img
              src="/gutter.png"
              alt=""
              className="absolute left-0 top-0 h-full w-auto max-w-none"
            />
          </div>
        )}
        {gutterHeight > 0 && (
          <div
            className="hidden xl:block fixed top-0 right-0 w-[calc((100vw-1280px)/2)] overflow-hidden pointer-events-none select-none [mask-image:linear-gradient(to_left,black_70%,transparent)]"
            style={{ height: `${gutterHeight}px` }}
            aria-hidden="true"
          >
            <img
              src="/gutter.png"
              alt=""
              className="absolute right-0 top-0 h-full w-auto max-w-none"
            />
          </div>
        )}
        {/* Skip link for keyboard users: invisible until focused (Tab
            from the URL bar lands here first), then appears as a
            button in the top-left to bypass the sticky Nav. Lets
            screen-reader and keyboard-only users skip the seven nav
            links and go straight to page content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:bg-oak focus:text-neutral-950 focus:text-sm focus:font-medium focus:rounded focus:shadow-lg"
        >
          Skip to main content
        </a>
        <Nav />
        <main id="main" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <Outlet />
        </main>
        <CommandPalette />
      </div>
    </ConfirmModalProvider>
  );
}
