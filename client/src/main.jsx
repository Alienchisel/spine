import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider, Link } from 'react-router-dom';
import { MOD_KEY } from './utils.js';
import App from './App.jsx';
// Eager: the two workhorse surfaces on the cold-load path. Library is the
// landing page; BookDetail is the most common next click. Keeping them in
// the main chunk avoids a Suspense flash on the user's typical first
// interaction. Everything else is lazy below.
import Library from './pages/Library.jsx';
import BookDetail from './pages/BookDetail.jsx';
// Lazy-load everything else. Most pages are reached via Nav clicks or
// filter affordances and aren't on the cold-load critical path. The
// Suspense boundary in App.jsx renders a null fallback while the chunk
// is in flight — typical loads are sub-100ms and page-level loading
// states take over within ~50ms of mount. This shaves the main bundle
// substantially: each lazy() call splits the page (and any imports
// unique to it) into its own chunk that's only fetched on navigation.
const BookForm     = React.lazy(() => import('./pages/BookForm.jsx'));
const BrowsePage   = React.lazy(() => import('./pages/BrowsePage.jsx'));
const Author       = React.lazy(() => import('./pages/Author.jsx'));
const AuthorsIndex = React.lazy(() => import('./pages/AuthorsIndex.jsx'));
const TagsIndex    = React.lazy(() => import('./pages/TagsIndex.jsx'));
const SeriesIndex  = React.lazy(() => import('./pages/SeriesIndex.jsx'));
const Readlist     = React.lazy(() => import('./pages/Readlist.jsx'));
const Loved        = React.lazy(() => import('./pages/Loved.jsx'));
const Lists        = React.lazy(() => import('./pages/Lists.jsx'));
const ListDetail   = React.lazy(() => import('./pages/ListDetail.jsx'));
const Diary        = React.lazy(() => import('./pages/Diary.jsx'));
const Notes        = React.lazy(() => import('./pages/Notes.jsx'));
const Audit        = React.lazy(() => import('./pages/Audit.jsx'));
const ShelfManager = React.lazy(() => import('./pages/ShelfManager.jsx'));
const ShelfView    = React.lazy(() => import('./pages/ShelfView.jsx'));
const Stats        = React.lazy(() => import('./pages/Stats/index.jsx'));
const Collage      = React.lazy(() => import('./pages/Collage.jsx'));
const AuditWizard  = React.lazy(() => import('./pages/AuditWizard/index.jsx'));
const DataViz      = React.lazy(() => import('./pages/DataViz.jsx'));
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
