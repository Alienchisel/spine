import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Link } from 'react-router-dom';
import { MOD_KEY } from './utils.js';
import App from './App.jsx';
import Library from './pages/Library.jsx';
import BookDetail from './pages/BookDetail.jsx';
import BookForm from './pages/BookForm.jsx';
import BrowsePage from './pages/BrowsePage.jsx';
import Author from './pages/Author.jsx';
import AuthorsIndex from './pages/AuthorsIndex.jsx';
import TagsIndex from './pages/TagsIndex.jsx';
import SeriesIndex from './pages/SeriesIndex.jsx';
import Readlist from './pages/Readlist.jsx';
import Loved from './pages/Loved.jsx';
import Lists from './pages/Lists.jsx';
import ListDetail from './pages/ListDetail.jsx';
import Diary from './pages/Diary.jsx';
import Notes from './pages/Notes.jsx';
import Audit from './pages/Audit.jsx';
import ShelfManager from './pages/ShelfManager.jsx';
// Lazy-load the four heaviest pages: Stats pulls recharts (~70KB gzip),
// DataViz + Collage pull html2canvas-pro (~50KB), AuditWizard is its own
// fat tree of cover/portrait/enum mode grids. None is the user's first
// landing surface, so deferring them shaves ~120KB off the initial
// JS chunk and lets the Library + Loved + BookDetail surfaces paint
// faster. Suspense boundary lives in App.jsx (around <Outlet/>).
const Stats       = React.lazy(() => import('./pages/Stats.jsx'));
const Collage     = React.lazy(() => import('./pages/Collage.jsx'));
const AuditWizard = React.lazy(() => import('./pages/AuditWizard/index.jsx'));
const DataViz     = React.lazy(() => import('./pages/DataViz.jsx'));
import ShelfView from './pages/ShelfView.jsx';
import RouteError from './components/RouteError.jsx';
import './index.css';

// Renders when the URL doesn't match any of the routes below (path="*").
// Mirrors RouteError's calm-recovery shape — heading + recovery copy +
// text-link affordances — so the 404 reads as a managed surface instead
// of a stray bit of body text on an otherwise-styled chrome.
function NotFound() {
  return (
    <div className="max-w-3xl py-6">
      <h1 className="text-xl text-neutral-300 mb-2">Page not found.</h1>
      <p className="text-sm text-neutral-500 mb-6">
        The URL you followed doesn't match any page in Spine. The library is the safest place to start over from.
      </p>
      <div className="flex items-center gap-4 text-sm">
        <Link to="/" className="text-neutral-400 hover:text-neutral-200 focus-visible:text-neutral-200 focus-visible:underline underline-offset-2 focus-visible:outline-none transition-colors">
          ← Back to Library
        </Link>
        <span className="text-neutral-700">
          or press <kbd className="font-sans text-[11px] text-neutral-500 border border-neutral-700 rounded px-1.5 py-0.5">{MOD_KEY}+K</kbd> to search
        </span>
      </div>
    </div>
  );
}

// Data router (vs. <BrowserRouter>) so BookForm and any future page can use
// useBlocker, loaders, actions, etc. The router instance lives at module
// scope so HMR doesn't re-create it on every reload. App.jsx becomes a
// layout route (it renders its shell + <Outlet/>); page-level routes are
// nested under it.
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route path="/" element={<App />} errorElement={<RouteError />}>
      {/* Pathless wrapper with errorElement so a thrown route still
          renders inside App's chrome (Nav stays put) instead of being
          replaced wholesale by the default React Router crash screen.
          The outer errorElement on the layout route catches the rarer
          case of App / Nav itself throwing, which would otherwise
          bubble past the inner boundary. */}
      <Route errorElement={<RouteError />}>
        <Route index                        element={<Library />} />
        <Route path="books/new"             element={<BookForm />} />
        <Route path="books/:id"             element={<BookDetail />} />
        <Route path="books/:id/edit"        element={<BookForm />} />
        <Route path="browse/:field/:value"  element={<BrowsePage />} />
        <Route path="authors"               element={<AuthorsIndex />} />
        <Route path="authors/:id"           element={<Author />} />
        <Route path="tags"                  element={<TagsIndex />} />
        <Route path="series"                element={<SeriesIndex />} />
        <Route path="readlist"              element={<Readlist />} />
        <Route path="loved"                 element={<Loved />} />
        <Route path="lists"                 element={<Lists />} />
        <Route path="lists/:id"             element={<ListDetail />} />
        <Route path="diary"                 element={<Diary />} />
        <Route path="notes"                 element={<Notes />} />
        <Route path="stats"                 element={<Stats />} />
        <Route path="collage"               element={<Collage />} />
        <Route path="audit"                 element={<Audit />} />
        <Route path="audit/wizard/:wizardKey" element={<AuditWizard />} />
        <Route path="data-viz"              element={<DataViz />} />
        <Route path="shelf"                 element={<ShelfManager />} />
        <Route path="shelf-view"            element={<ShelfView />} />
        <Route path="*"                     element={<NotFound />} />
      </Route>
    </Route>
  )
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
