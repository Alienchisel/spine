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
        <Nav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <Outlet />
        </main>
        <CommandPalette />
      </div>
    </ConfirmModalProvider>
  );
}
