import { Outlet } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import { ConfirmModalProvider } from './components/ConfirmModal.jsx';

// Layout route for the data router defined in main.jsx — renders the
// shared shell (Nav + main wrapper) and the per-route page via <Outlet/>.
// ConfirmModalProvider must wrap <Outlet/> so every page can call
// useConfirm() through context.
export default function App() {
  return (
    <ConfirmModalProvider>
      <div className="min-h-screen bg-neutral-950">
        <Nav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <Outlet />
        </main>
      </div>
    </ConfirmModalProvider>
  );
}
