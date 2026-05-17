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
        {/* Left-gutter atmosphere art. Width is sized to the exact
            gutter at any viewport via calc((100vw - 1280px) / 2) —
            content is max-w-7xl centered with mx-auto, so the gutter
            on each side is half the leftover viewport space. The art
            never overlaps the content column. object-cover + object-
            left shows the lit left half of the image, cropping the
            dark void on the right; a soft mask fade on the rendered
            right edge blends what's left into the page bg without a
            visible seam. Hidden below xl: where the gutter collapses
            to zero. Negative z-index isn't safe here (static parents
            don't create a stacking context for negative-z kids and the
            wrapper's bg would hide it) — DOM order + pointer-events-
            none does the stacking instead. */}
        <img
          src="/gutter-left.png"
          alt=""
          aria-hidden="true"
          className="hidden xl:block fixed top-0 left-0 h-screen w-[calc((100vw-1280px)/2)] object-cover object-left pointer-events-none select-none [mask-image:linear-gradient(to_right,black_70%,transparent)]"
        />
        {/* Right-gutter atmosphere art. Mirror of the left: object-right
            shows the lit art on the right edge of the source image, and
            the mask fades the LEFT side (the rendered inner edge) into
            the page bg so the seam against the content column
            disappears. */}
        <img
          src="/gutter-right.png"
          alt=""
          aria-hidden="true"
          className="hidden xl:block fixed top-0 right-0 h-screen w-[calc((100vw-1280px)/2)] object-cover object-right pointer-events-none select-none [mask-image:linear-gradient(to_left,black_70%,transparent)]"
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
