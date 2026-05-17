import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import { ConfirmModalProvider } from './components/ConfirmModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';

// Layout route for the data router defined in main.jsx — renders the
// shared shell (Nav + main wrapper) and the per-route page via <Outlet/>.
// ConfirmModalProvider must wrap <Outlet/> so every page can call
// useConfirm() through context.
export default function App() {
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
        {/* Left-gutter atmosphere art. Fixed to the viewport so it doesn't
            scroll with content; full-height with auto width preserves the
            image's portrait aspect (887×1774); hidden below lg: so it
            never crowds the content column on narrower screens. The art
            already has a dark fade on its right edge, so it bleeds into
            the page bg naturally — no opacity tweak needed at the seam.
            DOM order (img → Nav → main) gives natural stacking with all
            at z-auto: Nav/main paint on top of the img where they
            overlap, the gutter region shows the art through. Negative
            z-index would push the img behind the wrapper's own bg
            (static parents don't create a stacking context for
            negative-z descendants) — so we leave z-auto and rely on
            paint order instead. */}
        <img
          src="/gutter-left.png"
          alt=""
          aria-hidden="true"
          className="hidden lg:block fixed top-0 left-0 h-screen w-auto pointer-events-none select-none"
        />
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
